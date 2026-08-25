import type { BrowserContext, Page } from 'playwright';
import { sanearHtmlEnunciado } from '../html/sanear';
import type { CanalNdjson } from '../ndjson';
import { urlBaseDe } from '../plataformas';
import type { ActividadRef, EnunciadoExtraido, PlataformaId } from '../types';
import { comprobarSesionViva, SesionCaducadaError } from './login';
import { conNavegador, crearContextoAutenticado } from './navegador';
import { rutaEditorActividad, SELECTORES } from './selectores';

const TIMEOUT_BLOQUE = 15_000;
const TIMEOUT_TEXTAREA = 5_000;

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
  const trabajadores = concurrencia(total);

  return conNavegador(async (browser) => {
    canal.log(`Iniciando extracción de ${total} enunciados (${trabajadores} en paralelo)...`);

    const context: BrowserContext = await crearContextoAutenticado(browser, storageState);
    const resultados = new Array<EnunciadoExtraido>(total);

    let siguiente = 0;
    let completadas = 0;

    const trabajador = async () => {
      const page = await context.newPage();
      try {
        while (true) {
          const i = siguiente++;
          if (i >= total || canal.cancelado()) break;

          resultados[i] = await extraerUna(page, urlBase, actividades[i], canal);

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
    const extraidos = resultados.filter(Boolean);
    canal.log(`Extracción completada. ${extraidos.length} procesados.`);
    return extraidos;
  });
}
