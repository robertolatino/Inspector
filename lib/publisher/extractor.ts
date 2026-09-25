import type { BrowserContext, Locator, Page } from 'playwright';
import { sanearHtmlEnunciado } from '../html/sanear';
import type { CanalNdjson } from '../ndjson';
import { urlBaseDe } from '../plataformas';
import type { ActividadCaptura, ActividadCompleta, ActividadRef, Captura, EnunciadoExtraido, PlataformaId } from '../types';
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
/** Margen de sobra al agrandar el viewport, para no dejarlo justo al límite. */
const MARGEN_VIEWPORT = 40;

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
 * Captura la vista previa de la pregunta (ya visible) y sus dimensiones
 * reales. Una captura fallida no debe tirar toda la actividad: se guarda sin
 * preview visual y ya está. El tamaño real (`boundingBox`) hace falta para
 * incrustarla en el Word sin deformarla: `docx` no lee las dimensiones del
 * propio JPEG.
 *
 * La barra "Salir/Guardar" (`piePagina`) es `position: sticky`: en
 * actividades con una vista previa alta (varias frases, muchas fichas...) su
 * borde inferior cae en la misma región de pantalla donde esa barra está
 * pintada, y la captura se la lleva por delante. Se oculta antes de capturar
 * — no hace falta restaurarla, la siguiente actividad navega a una página
 * nueva.
 *
 * El editor no hace scroll de la página: hace scroll de un contenedor interno
 * (`overflow-y: auto`), así que una vista previa más alta que el viewport
 * (p. ej. "Unir" con muchos pares, "Clasificar" con muchas palabras) no cabe
 * entera en la ventana — Playwright solo puede capturar lo que está pintado
 * dentro del viewport en ese momento, aunque el elemento "sepa" que mide más,
 * así que el resto salía recortado y en blanco. Se agranda el viewport de esa
 * pestaña cuando hace falta, antes de capturar; queda así para el resto de
 * actividades que procese esa misma pestaña, lo cual no hace daño (una
 * ventana más alta de lo necesario no cambia el recorte de una captura más
 * pequeña).
 */
async function capturarVistaPrevia(pregunta: Locator): Promise<Captura> {
  try {
    const page = pregunta.page();

    await page
      .locator(SELECTORES.editor.piePagina)
      .evaluate((el) => {
        (el as HTMLElement).style.visibility = 'hidden';
      })
      .catch(() => {
        /* si no está, nada que ocultar */
      });

    const cajaInicial = await pregunta.first().boundingBox();
    if (cajaInicial) {
      const vp = page.viewportSize();
      const altoNecesario = Math.ceil(cajaInicial.y + cajaInicial.height + MARGEN_VIEWPORT);
      const anchoNecesario = Math.ceil(cajaInicial.x + cajaInicial.width + MARGEN_VIEWPORT);
      if (vp && (altoNecesario > vp.height || anchoNecesario > vp.width)) {
        await page.setViewportSize({
          width: Math.max(vp.width, anchoNecesario),
          height: Math.max(vp.height, altoNecesario),
        });
      }
    }

    const caja = await pregunta.first().boundingBox();
    const buffer = await pregunta.first().screenshot({ type: 'jpeg', quality: CALIDAD_CAPTURA });
    return {
      capturaBase64: buffer.toString('base64'),
      capturaAncho: caja ? Math.round(caja.width) : null,
      capturaAlto: caja ? Math.round(caja.height) : null,
    };
  } catch {
    return { capturaBase64: null, capturaAncho: null, capturaAlto: null };
  }
}

/**
 * Lee el tipo de plantilla, la captura visual y el HTML del ejercicio.
 *
 * El ejercicio existe dos veces: dentro de la vista previa (como lo ve el
 * alumno, con el enunciado repetido y el orden desordenado) y dentro de
 * "Soluciones" (limpio, sin el enunciado ni el desorden) — se prefiere este
 * segundo, y solo se cae al de la vista previa si la actividad no tiene panel
 * de soluciones (p. ej. Matemáticas). No hay que pulsar nada para verlo: la
 * pestaña "Solución" ya está seleccionada por defecto.
 */
async function extraerBloqueCompleto(
  page: Page,
): Promise<{ claseTipo: string | null; ejercicioHtml: string | null } & Captura> {
  const pregunta = page.locator(SELECTORES.editor.vistaPreviaPregunta);
  await pregunta.waitFor({ state: 'visible', timeout: TIMEOUT_BLOQUE });

  const claseTipo = await page
    .locator(SELECTORES.editor.tipoPregunta)
    .first()
    .getAttribute('class')
    .catch(() => null);

  const captura = await capturarVistaPrevia(pregunta);

  const solucion = page.locator(SELECTORES.editor.vistaPreviaSolucion);
  const ejercicioSolucion =
    (await solucion.count()) > 0
      ? await solucion
          .locator(SELECTORES.editor.ejercicio)
          .first()
          .evaluate((el) => el.innerHTML)
          .catch(() => null)
      : null;
  const ejercicioHtml =
    ejercicioSolucion ??
    (await pregunta
      .locator(SELECTORES.editor.ejercicio)
      .first()
      .evaluate((el) => el.innerHTML)
      .catch(() => null));

  return { claseTipo, ejercicioHtml, ...captura };
}

/**
 * Igual que `extraerUna`, pero además extrae el tipo de plantilla, una
 * captura visual y el HTML del ejercicio — sin interpretar nada por tipo de
 * plantilla, tal cual aparece en el backoffice. Un fallo leyendo la vista
 * previa no descarta el enunciado ya leído.
 */
async function extraerCompleta(
  page: Page,
  urlBase: string,
  actividad: ActividadRef,
  canal: CanalNdjson<unknown>,
): Promise<ActividadCompleta> {
  const codigo = actividad.Name;

  const sinDatos = {
    tipoPlantilla: 'Desconocido',
    ejercicioHtml: null,
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

  try {
    const { claseTipo, ejercicioHtml, capturaBase64, capturaAncho, capturaAlto } =
      await extraerBloqueCompleto(page);
    const tipoPlantilla = nombreTipoPlantilla(claseTipo, (clase) =>
      canal.log(`[?] Tipo de plantilla sin traducir en ${codigo}: ${clase}`),
    );

    return {
      codigo,
      tipoPlantilla,
      enunciadoHtml,
      ejercicioHtml: ejercicioHtml ? sanearHtmlEnunciado(ejercicioHtml) : null,
      capturaBase64,
      capturaAncho,
      capturaAlto,
    };
  } catch {
    canal.log(`[⚠️] No se pudo leer la vista previa de la pregunta en ${codigo}.`);
    return { codigo, enunciadoHtml, ...sinDatos };
  }
}

/**
 * Modo "captura": ni enunciado ni tipo, solo navega y captura la vista
 * previa. Es el modo más ligero de los tres — pensado para revisar de un
 * vistazo un lote grande sin esperar a leer nada de texto.
 */
async function extraerCaptura(
  page: Page,
  urlBase: string,
  actividad: ActividadRef,
  canal: CanalNdjson<unknown>,
): Promise<ActividadCaptura> {
  const codigo = actividad.Name;
  const sinCaptura = { capturaBase64: null, capturaAncho: null, capturaAlto: null };

  try {
    await page.goto(`${urlBase}${rutaEditorActividad(actividad['GUID/ERP'])}`, {
      waitUntil: 'domcontentloaded',
    });
    comprobarSesionViva(page);
  } catch (e) {
    if (e instanceof SesionCaducadaError) throw e;
    canal.log(`[❌] Error de navegación en ${codigo}. Se continúa con la siguiente.`);
    return { codigo, ...sinCaptura };
  }

  try {
    const pregunta = page.locator(SELECTORES.editor.vistaPreviaPregunta);
    await pregunta.waitFor({ state: 'visible', timeout: TIMEOUT_BLOQUE });
    return { codigo, ...(await capturarVistaPrevia(pregunta)) };
  } catch {
    canal.log(`[⚠️] No se pudo capturar la vista previa de ${codigo}.`);
    return { codigo, ...sinCaptura };
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
 * enunciado, extrae el tipo de plantilla, una captura visual y el HTML del
 * ejercicio de cada actividad — sin interpretar nada por tipo, tal cual
 * aparece en el backoffice. Ver `extraerBloqueCompleto`.
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

/**
 * Modo "captura": solo la vista previa visual de cada actividad, sin leer
 * enunciado ni tipo de plantilla. Ver `extraerCaptura`.
 */
export async function extraerCapturas(opciones: {
  plataforma: PlataformaId;
  storageState: string;
  actividades: ActividadRef[];
  canal: CanalNdjson<ActividadCaptura[]>;
}): Promise<ActividadCaptura[]> {
  const { plataforma, storageState, actividades, canal } = opciones;
  const urlBase = urlBaseDe(plataforma);
  const total = actividades.length;

  return conNavegador(async (browser) => {
    canal.log(`Iniciando captura de ${total} actividades (${concurrencia(total)} en paralelo)...`);

    const context: BrowserContext = await crearContextoAutenticado(browser, storageState);
    const resultados = await ejecutarConPool(context, actividades, canal, (page, actividad) =>
      extraerCaptura(page, urlBase, actividad, canal),
    );

    canal.log(`Extracción completada. ${resultados.length} procesados.`);
    return resultados;
  });
}
