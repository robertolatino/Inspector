import type { BrowserContext, Page } from 'playwright';
import { sanearHtmlEnunciado } from '../html/sanear';
import type { CanalNdjson } from '../ndjson';
import { urlBaseDe } from '../plataformas';
import type { ActividadCompleta, ActividadRef, EnunciadoExtraido, PlataformaId } from '../types';
import { analizarSolucion } from './analizarSolucion';
import { comprobarSesionViva, SesionCaducadaError } from './login';
import { conNavegador, crearContextoAutenticado } from './navegador';
import { rutaEditorActividad, SELECTORES } from './selectores';
import { nombreTipoPlantilla } from './tipoPlantilla';

const TIMEOUT_BLOQUE = 15_000;
const TIMEOUT_TEXTAREA = 5_000;
/** JPEG en vez de PNG y calidad moderada: el preview pesa poco de por sí (es
 * solo el recorte del elemento, no la página), pero en un lote de cientos de
 * actividades cada KB cuenta para lo que se guarda en el navegador. */
const CALIDAD_CAPTURA = 70;

/**
 * Pestañas en paralelo. Cada una es un Chromium tab dentro del mismo contexto,
 * así que comparten la sesión y cuestan poco. Cuatro es el equilibrio que
 * aguanta una instancia de Cloud Run de 2 vCPU sin saturarse.
 */
const CONCURRENCIA_POR_DEFECTO = 4;

function concurrencia(total: number): number {
  const configurada = Number(process.env.EXTRACTOR_CONCURRENCIA);
  const n = Number.isFinite(configurada) && configurada > 0 ? configurada : CONCURRENCIA_POR_DEFECTO;
  return Math.max(1, Math.min(n, total));
}

/**
 * Reparte `actividades` entre un pool de pestañas y escribe cada resultado
 * **en su posición**, de modo que el orden de entrada se conserva aunque las
 * actividades terminen desordenadas. Lo comparten `extraerEnunciados` y
 * `extraerActividadesCompletas`: la única diferencia entre ambos modos es qué
 * hace `procesar` con cada actividad.
 */
async function ejecutarConPool<T>(
  context: BrowserContext,
  actividades: ActividadRef[],
  canal: CanalNdjson<unknown>,
  procesar: (page: Page, actividad: ActividadRef) => Promise<T>,
): Promise<T[]> {
  const total = actividades.length;
  const trabajadores = concurrencia(total);
  const resultados = new Array<T>(total);

  let siguiente = 0;
  let completadas = 0;

  const trabajador = async () => {
    const page = await context.newPage();
    try {
      while (true) {
        const i = siguiente++;
        if (i >= total || canal.cancelado()) break;

        resultados[i] = await procesar(page, actividades[i]);

        completadas++;
        canal.log(`[${completadas}/${total}] ${actividades[i].Name}`);
      }
    } finally {
      await page.close().catch(() => {
        /* el contexto puede haberse cerrado ya */
      });
    }
  };

  await Promise.all(Array.from({ length: trabajadores }, trabajador));

  if (canal.cancelado()) canal.log('Extracción cancelada.');

  // Si se canceló a medias, los huecos del array quedarían vacíos.
  return resultados.filter(Boolean);
}

/**
 * Extrae el enunciado de una actividad. Un fallo de una actividad concreta no
 * detiene el lote: se devuelve un marcador y se sigue. La excepción es la sesión
 * caducada, que se propaga — si no, un storageState vencido devolvería
 * silenciosamente cientos de marcadores en vez de avisar al usuario.
 */
async function extraerUna(
  page: Page,
  urlBase: string,
  actividad: ActividadRef,
  canal: CanalNdjson<unknown>,
): Promise<EnunciadoExtraido> {
  const codigo = actividad.Name;

  try {
    await page.goto(`${urlBase}${rutaEditorActividad(actividad['GUID/ERP'])}`, {
      waitUntil: 'domcontentloaded',
    });
    comprobarSesionViva(page);
  } catch (e) {
    if (e instanceof SesionCaducadaError) throw e;
    canal.log(`[❌] Error de navegación en ${codigo}. Se continúa con la siguiente.`);
    return { codigo, enunciadoHtml: '[ERROR DE NAVEGACIÓN]' };
  }

  try {
    const bloque = page.locator(SELECTORES.editor.bloqueEnunciado);
    await bloque.waitFor({ state: 'visible', timeout: TIMEOUT_BLOQUE });

    // El textarea del WYSIWYG está oculto: basta con que exista en el DOM.
    const textarea = bloque.locator(SELECTORES.editor.textareaEnunciado).first();
    await textarea.waitFor({ state: 'attached', timeout: TIMEOUT_TEXTAREA });

    const html = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value);
    return { codigo, enunciadoHtml: sanearHtmlEnunciado(html) };
  } catch {
    canal.log(`[⚠️] No se encontró el enunciado en el editor de ${codigo}.`);
    return { codigo, enunciadoHtml: '[SIN ENUNCIADO EN EL EDITOR]' };
  }
}

/**
 * Lee la vista previa de la pregunta y, si llega a renderizarse, la de su
 * solución. No hace falta pulsar nada: la pestaña "Solución" ya está
 * seleccionada por defecto. El panel de soluciones no siempre existe —en
 * Matemáticas no llega a renderizarse—, así que aquí no se espera con
 * `waitFor`: consultarlo directamente y tratar su ausencia como "sin
 * solución" evita penalizar esas actividades con el timeout completo.
 */
async function extraerBloqueCompleto(page: Page): Promise<{
  preguntaHtml: string;
  solucionHtml: string | null;
  claseTipo: string | null;
  capturaBase64: string | null;
  capturaAncho: number | null;
  capturaAlto: number | null;
}> {
  const pregunta = page.locator(SELECTORES.editor.vistaPreviaPregunta);
  await pregunta.waitFor({ state: 'visible', timeout: TIMEOUT_BLOQUE });
  const preguntaHtml = await pregunta.first().evaluate((el) => el.innerHTML);

  const claseTipo = await page
    .locator(SELECTORES.editor.tipoPregunta)
    .first()
    .getAttribute('class')
    .catch(() => null);

  // Una captura fallida no debe tirar toda la actividad: se guarda sin
  // preview visual y ya está — el texto de abajo sigue siendo la fuente real.
  // El tamaño real (`boundingBox`) hace falta para incrustarla en el Word sin
  // deformarla: `docx` no lee las dimensiones del propio JPEG.
  let capturaBase64: string | null = null;
  let capturaAncho: number | null = null;
  let capturaAlto: number | null = null;
  try {
    const caja = await pregunta.first().boundingBox();
    const buffer = await pregunta.first().screenshot({ type: 'jpeg', quality: CALIDAD_CAPTURA });
    capturaBase64 = buffer.toString('base64');
    capturaAncho = caja ? Math.round(caja.width) : null;
    capturaAlto = caja ? Math.round(caja.height) : null;
  } catch {
    /* sin preview visual; el resto de la actividad se extrae igual */
  }

  const solucion = page.locator(SELECTORES.editor.vistaPreviaSolucion);
  const solucionHtml =
    (await solucion.count()) > 0 ? await solucion.first().evaluate((el) => el.innerHTML) : null;

  return { preguntaHtml, solucionHtml, claseTipo, capturaBase64, capturaAncho, capturaAlto };
}

/**
 * Igual que `extraerUna`, pero además lee las opciones y —cuando el tipo de
 * plantilla lo permite— la respuesta correcta, vía `analizarSolucion`. Un
 * fallo leyendo la vista previa/solución no descarta el enunciado ya leído:
 * se devuelve con `detalle: null`, igual que un enunciado no encontrado.
 */
async function extraerCompleta(
  page: Page,
  urlBase: string,
  actividad: ActividadRef,
  canal: CanalNdjson<unknown>,
): Promise<ActividadCompleta> {
  const codigo = actividad.Name;

  const sinDatos = {
    nombre: codigo,
    tipoPlantilla: 'Desconocido',
    detalle: null,
    capturaBase64: null,
    capturaAncho: null,
    capturaAlto: null,
  };

  try {
    await page.goto(`${urlBase}${rutaEditorActividad(actividad['GUID/ERP'])}`, {
      waitUntil: 'domcontentloaded',
    });
    comprobarSesionViva(page);
  } catch (e) {
    if (e instanceof SesionCaducadaError) throw e;
    canal.log(`[❌] Error de navegación en ${codigo}. Se continúa con la siguiente.`);
    return { codigo, enunciadoHtml: '[ERROR DE NAVEGACIÓN]', ...sinDatos };
  }

  let enunciadoHtml: string;
  try {
    const bloque = page.locator(SELECTORES.editor.bloqueEnunciado);
    await bloque.waitFor({ state: 'visible', timeout: TIMEOUT_BLOQUE });

    const textarea = bloque.locator(SELECTORES.editor.textareaEnunciado).first();
    await textarea.waitFor({ state: 'attached', timeout: TIMEOUT_TEXTAREA });

    const html = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value);
    enunciadoHtml = sanearHtmlEnunciado(html);
  } catch {
    canal.log(`[⚠️] No se encontró el enunciado en el editor de ${codigo}.`);
    return { codigo, enunciadoHtml: '[SIN ENUNCIADO EN EL EDITOR]', ...sinDatos };
  }

  // El nombre interno es una lectura barata y casi nunca falla; si falla, el
  // código sirve igual de título en el Word.
  const nombre = await page
    .locator(SELECTORES.editor.nombreInterno)
    .first()
    .inputValue()
    .then((valor) => valor || codigo)
    .catch(() => codigo);

  try {
    const { preguntaHtml, solucionHtml, claseTipo, capturaBase64, capturaAncho, capturaAlto } =
      await extraerBloqueCompleto(page);
    const detalle = analizarSolucion(preguntaHtml, solucionHtml);
    const tipoPlantilla = nombreTipoPlantilla(claseTipo, (clase) =>
      canal.log(`[?] Tipo de plantilla sin traducir en ${codigo}: ${clase}`),
    );

    // Solo se audita cuando SÍ había panel de soluciones y aun así no se
    // reconoció ningún patrón: cuando el panel directamente no existe (p. ej.
    // Matemáticas, Emparejar) el "sin_solucion" es el resultado esperado, no
    // un caso a revisar.
    if (detalle.patron === 'sin_solucion' && solucionHtml) {
      canal.log(`[?] Patrón de respuesta no reconocido en ${codigo}: se guarda solo lo visible.`);
    }

    return { codigo, nombre, tipoPlantilla, enunciadoHtml, detalle, capturaBase64, capturaAncho, capturaAlto };
  } catch {
    canal.log(`[⚠️] No se pudo leer la vista previa de la pregunta en ${codigo}.`);
    return { codigo, enunciadoHtml, ...sinDatos, nombre };
  }
}

/**
 * Extrae los enunciados de una lista de actividades.
 *
 * Antes era un bucle secuencial en una sola pestaña: 5-10 s por actividad, o
 * 30-50 minutos para un libro grande. Ahora un pool de pestañas consume una
 * cola de índices y escribe cada resultado **en su posición**, de modo que el
 * orden del Excel de entrada se conserva aunque las actividades terminen
 * desordenadas.
 */
export async function extraerEnunciados(opciones: {
  plataforma: PlataformaId;
  storageState: string;
  actividades: ActividadRef[];
  canal: CanalNdjson<EnunciadoExtraido[]>;
}): Promise<EnunciadoExtraido[]> {
  const { plataforma, storageState, actividades, canal } = opciones;
  const urlBase = urlBaseDe(plataforma);
  const total = actividades.length;

  return conNavegador(async (browser) => {
    canal.log(`Iniciando extracción de ${total} enunciados (${concurrencia(total)} en paralelo)...`);

    const context: BrowserContext = await crearContextoAutenticado(browser, storageState);
    const resultados = await ejecutarConPool(context, actividades, canal, (page, actividad) =>
      extraerUna(page, urlBase, actividad, canal),
    );

    canal.log(`Extracción completada. ${resultados.length} procesados.`);
    return resultados;
  });
}

/**
 * Igual que `extraerEnunciados`, pero en "modo completo": además del
 * enunciado, extrae las opciones y —cuando se puede saber— la respuesta
 * correcta de cada actividad. Ver `lib/publisher/analizarSolucion.ts` para
 * cómo se decide.
 */
export async function extraerActividadesCompletas(opciones: {
  plataforma: PlataformaId;
  storageState: string;
  actividades: ActividadRef[];
  canal: CanalNdjson<ActividadCompleta[]>;
}): Promise<ActividadCompleta[]> {
  const { plataforma, storageState, actividades, canal } = opciones;
  const urlBase = urlBaseDe(plataforma);
  const total = actividades.length;

  return conNavegador(async (browser) => {
    canal.log(
      `Iniciando extracción completa de ${total} actividades (${concurrencia(total)} en paralelo)...`,
    );

    const context: BrowserContext = await crearContextoAutenticado(browser, storageState);
    const resultados = await ejecutarConPool(context, actividades, canal, (page, actividad) =>
      extraerCompleta(page, urlBase, actividad, canal),
    );

    canal.log(`Extracción completada. ${resultados.length} procesados.`);
    return resultados;
  });
}
