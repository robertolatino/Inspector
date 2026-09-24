import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { sanearHtmlEnunciado } from '../html/sanear.ts';
import type { DetalleCompleto, FilaTabla, OpcionRespuesta } from '../types';

/**
 * Interpreta el HTML de la vista previa de la pregunta (`.lemo-question-preview`)
 * y de su solución (`.lemo-solutions-preview`) para decidir qué patrón de
 * respuesta usar.
 *
 * El backoffice no expone el tipo de plantilla de forma fiable junto a la
 * actividad (ver notas de exploración en memoria del proyecto: el código
 * `questionType` de la URL no se corresponde con el tipo real), así que aquí no
 * se decide por tipo sino por la FORMA del DOM: qué clases `lemo-*` aparecen y
 * cómo. Cada patrón tiene su propio detector, pequeño e independiente, probado
 * en cascada — así cada uno se puede testear por separado con HTML de fixture,
 * igual que `parseEnunciado.ts`.
 *
 * Un patrón mal reconocido (una respuesta marcada como correcta sin serlo) es
 * peor que no reconocer ninguno: por eso cualquier caso que no encaje con
 * claridad en ningún detector cae en `sin_solucion` en vez de arriesgarse.
 */

const normalizar = (texto: string): string => texto.replace(/\s+/g, ' ').trim();

/** Texto de un elemento, colapsando saltos de línea a espacios. */
function textoDe($: cheerio.CheerioAPI, el: AnyNode): string {
  return normalizar($(el).text());
}

/** HTML saneado de un elemento suelto (no de un documento completo). */
function htmlSaneadoDe($: cheerio.CheerioAPI, el: AnyNode): string {
  return sanearHtmlEnunciado($.html(el) ?? '');
}

/**
 * Patrón "tabla": preguntas en forma de matriz (p. ej. Verdadero/Falso en
 * cuadrícula). Cada fila es un `.lemo-table-body-item`; dentro, un
 * `.lemo-table-grid` con el enunciado de la fila como primera celda y una
 * celda `.lemo-question-response` por columna, con `.lemo-selected` en la(s)
 * correcta(s). No hay cabecera de columnas en el DOM: cuando la celda no trae
 * texto propio (p. ej. solo un icono de check) se etiqueta la columna por
 * posición.
 */
function detectarTabla($: cheerio.CheerioAPI): DetalleCompleto | null {
  const filas = $('.lemo-table-body-item').toArray();
  if (filas.length === 0) return null;

  const filasTabla: FilaTabla[] = [];
  let textosEjemplo: string[] | null = null;

  for (const fila of filas) {
    const grid = $(fila).find('.lemo-table-grid').first();
    const celdasEl = (grid.length > 0 ? grid : $(fila)).children().toArray();
    if (celdasEl.length === 0) continue;

    const celdas = celdasEl.map((c) => htmlSaneadoDe($, c));
    const indiceCorrecta = celdasEl.findIndex((c) => $(c).hasClass('lemo-selected'));

    filasTabla.push({ celdas, columnaCorrecta: indiceCorrecta >= 0 ? indiceCorrecta : null });
    if (!textosEjemplo) textosEjemplo = celdasEl.map((c) => textoDe($, c));
  }

  if (filasTabla.length === 0) return null;

  const cabecera = (textosEjemplo ?? []).map((t, i) => (i === 0 ? '' : t || `Columna ${i}`));

  return { patron: 'tabla', tabla: { cabecera, filas: filasTabla } };
}

/**
 * Patrón "desplegable": cada hueco marca DOS elementos con `.lemo-selected` —
 * el hueco en sí (`.lemo-blank`, con el texto de todas las opciones pegado) y,
 * dentro de él, la opción elegida (`.lemo-dropdown-content-item`). Solo la
 * segunda es la respuesta.
 */
function detectarDesplegable($: cheerio.CheerioAPI): DetalleCompleto | null {
  const elegidas = $('.lemo-selected.lemo-dropdown-content-item').toArray();
  if (elegidas.length === 0) return null;

  const opciones: OpcionRespuesta[] = elegidas.map((el) => ({
    html: htmlSaneadoDe($, el),
    correcta: true,
  }));

  return { patron: 'desplegable', opciones };
}

/**
 * Patrón "opciones": elección de texto simple (Respuesta única, Selección
 * múltiple, Selección simple numerada...). El elemento marcado con
 * `.lemo-selected` lleva su propio texto — a diferencia del patrón "tabla",
 * donde la celda puede ir vacía.
 */
function detectarOpciones($: cheerio.CheerioAPI): DetalleCompleto | null {
  const conTexto = $('.lemo-selected')
    .toArray()
    .filter((el) => textoDe($, el) !== '');
  if (conTexto.length === 0) return null;

  const opciones: OpcionRespuesta[] = conTexto.map((el) => ({
    html: htmlSaneadoDe($, el),
    correcta: true,
  }));

  return { patron: 'opciones', opciones };
}

/**
 * Patrón "relleno": huecos sin `.lemo-selected`. Dos variantes vistas en la
 * exploración en vivo:
 * - `.lemo-cloze-text-blank`: hueco de texto/número escrito (el valor correcto
 *   es su propio texto).
 * - `.lemo-drag-option.lemo-is-dropped`: arrastrar-y-soltar una palabra a un
 *   hueco. El contenedor `.lemo-blank` duplica el texto (la ficha arrastrada
 *   más el área de destino, que repite la misma palabra de fondo), así que se
 *   lee directamente de la ficha ya colocada en vez de del contenedor.
 */
function detectarRelleno($: cheerio.CheerioAPI): DetalleCompleto | null {
  const huecosTexto = $('.lemo-cloze-text-blank').toArray();
  if (huecosTexto.length > 0) {
    return { patron: 'relleno', relleno: huecosTexto.map((el) => textoDe($, el)) };
  }

  const huecosArrastrar = $('.lemo-drag-option.lemo-is-dropped').toArray();
  if (huecosArrastrar.length > 0) {
    return { patron: 'relleno', relleno: huecosArrastrar.map((el) => textoDe($, el)) };
  }

  return null;
}

/** Piezas de texto "hoja" (sin hijos con texto propio), en orden de aparición. */
function piezasDeTexto(html: string): string[] {
  const $ = cheerio.load(html);
  const piezas: string[] = [];

  $('body *').each((_, el) => {
    if ($(el).children().length > 0) return;
    const t = normalizar($(el).text());
    if (t && t !== 'Comprobar' && t !== 'Enviar') piezas.push(t);
  });

  return piezas;
}

function mismoMulticonjunto(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  const contar = (arr: string[]) => {
    const mapa = new Map<string, number>();
    for (const x of arr) mapa.set(x, (mapa.get(x) ?? 0) + 1);
    return mapa;
  };

  const ma = contar(a);
  const mb = contar(b);
  if (ma.size !== mb.size) return false;
  for (const [clave, veces] of ma) if (mb.get(clave) !== veces) return false;
  return true;
}

/**
 * Patrón "orden": sin `.lemo-selected`, pero la solución trae las mismas
 * piezas que la pregunta, solo que ya en el orden correcto (la pregunta las
 * muestra desordenadas). Camino rápido: `.lemo-option-list`, visto en la
 * actividad de "Ordenar" muestreada en vivo. Si no aparece, se compara el
 * multiconjunto de piezas de pregunta y solución como respaldo genérico.
 */
function detectarOrden(
  $sol: cheerio.CheerioAPI,
  preguntaHtml: string,
  solucionHtml: string,
): DetalleCompleto | null {
  const lista = $sol('.lemo-option-list').first();
  if (lista.length > 0) {
    const orden = lista
      .children()
      .toArray()
      .map((el) => textoDe($sol, el))
      .filter(Boolean);
    if (orden.length > 1) return { patron: 'orden', orden };
  }

  const piezasPregunta = piezasDeTexto(preguntaHtml);
  const piezasSolucion = piezasDeTexto(solucionHtml);

  if (
    piezasPregunta.length > 1 &&
    piezasPregunta.join('|') !== piezasSolucion.join('|') &&
    mismoMulticonjunto(piezasPregunta, piezasSolucion)
  ) {
    return { patron: 'orden', orden: piezasSolucion };
  }

  return null;
}

/**
 * Punto de entrada. `solucionHtml` es `null` cuando el panel de "Soluciones"
 * ni siquiera llega a renderizarse (p. ej. Matemáticas).
 */
export function analizarSolucion(preguntaHtml: string, solucionHtml: string | null): DetalleCompleto {
  const preguntaSaneada = sanearHtmlEnunciado(preguntaHtml);

  if (!solucionHtml || !normalizar(cheerio.load(solucionHtml).text())) {
    return { patron: 'sin_solucion', contenidoSinSolucion: preguntaSaneada };
  }

  const $ = cheerio.load(solucionHtml);

  return (
    detectarTabla($) ??
    detectarDesplegable($) ??
    detectarOpciones($) ??
    detectarRelleno($) ??
    detectarOrden($, preguntaHtml, solucionHtml) ?? {
      patron: 'sin_solucion',
      contenidoSinSolucion: preguntaSaneada,
    }
  );
}
