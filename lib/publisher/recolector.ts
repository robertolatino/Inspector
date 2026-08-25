import type { Page } from 'playwright';
import type { CanalNdjson } from '../ndjson';
import { urlBaseDe } from '../plataformas';
import type { ActividadRef, PlataformaId } from '../types';
import { filtrarPorPrefijo } from './filtrado';
import { comprobarSesionViva } from './login';
import { conNavegador, crearContextoAutenticado } from './navegador';
import { SELECTORES } from './selectores';

/** Tope de seguridad para que una paginación que nunca se deshabilite no cuelgue el proceso. */
const MAX_PAGINAS = 200;
const TIMEOUT_ELEMENTO = 20_000;
/** Cadencia con la que se comprueba si la tabla ha dejado de moverse. */
const INTERVALO_SONDEO = 250;
/**
 * Plazo para que el pie de paginación se repinte tras refrescarse la tabla.
 * Corto a propósito: en la última página se paga entero.
 */
const TIMEOUT_PAGINACION = 4_000;

interface FilaListado {
  href: string;
  guid: string;
  nombre: string;
}

/**
 * Lee de golpe todas las filas visibles.
 *
 * Antes se hacían dos llamadas al navegador por fila (`getAttribute` +
 * `innerText`): con 50 filas por página eran 100 idas y vueltas. Ahora es una.
 */
function leerFilas(page: Page): Promise<FilaListado[]> {
  return page.locator(SELECTORES.listado.filaActividad).evaluateAll((elementos) =>
    elementos.map((el) => {
      const href = el.getAttribute('href') ?? '';
      return {
        href,
        // El GUID es lo que va después del último '/'.
        guid: href.split('/').pop() ?? '',
        nombre: (el.querySelector('span')?.textContent ?? el.textContent ?? '').trim(),
      };
    }),
  );
}

/**
 * Huella del contenido de la tabla. Sirve para saber si ha cambiado y si ya ha
 * dejado de moverse. Una sola definición: si el formato divergiera entre los dos
 * puntos que la comparan, las huellas nunca coincidirían y la espera degradaría
 * en silencio a un timeout.
 */
function huellaDe(filas: FilaListado[]): string {
  return `${filas.length}:${filas.map((f) => f.guid).join(',')}`;
}

async function huellaTabla(page: Page): Promise<string> {
  return huellaDe(await leerFilas(page));
}

/**
 * Espera a que la tabla cambie respecto a `huellaPrevia` y luego se quede quieta.
 *
 * Hace falta porque el listado es una SPA y las filas antiguas siguen en el DOM
 * un instante: esperar a "que aparezca una fila" no vale de nada —ya hay filas—
 * y por eso la recolección llegó a leer la tabla sin filtrar y devolver
 * actividades de otros libros.
 *
 * `permitirVacia` es la otra mitad del problema. Al pasar de página la aplicación
 * **vacía la tabla mientras carga**, y contar ese hueco como "cambió y está
 * estable" hacía que la vuelta siguiente leyera cero filas y la recolección se
 * detuviera a mitad (20 de 79). Salvo justo después de buscar —donde cero
 * resultados es una respuesta legítima—, una tabla vacía significa "sigue
 * cargando", no "ya está".
 */
async function esperarTablaEstable(
  page: Page,
  huellaPrevia: string,
  canal: CanalNdjson<unknown>,
  permitirVacia = false,
): Promise<void> {
  const limite = Date.now() + TIMEOUT_ELEMENTO;
  let anterior = '';
  let habiaCambiado = false;

  while (Date.now() < limite) {
    const actual = await huellaTabla(page);
    const vacia = actual.startsWith('0:');

    if (actual !== huellaPrevia) habiaCambiado = true;

    // Dos lecturas iguales seguidas = el refresco ha terminado.
    if (habiaCambiado && actual === anterior && (permitirVacia || !vacia)) return;

    anterior = actual;
    await page.waitForTimeout(INTERVALO_SONDEO);
  }

  if (!permitirVacia) {
    canal.log('Aviso: el listado no ha terminado de cargar la página siguiente a tiempo.');
  }
}

/**
 * Radiografía de los controles de paginación.
 *
 * Sirve para diagnosticar por qué la recolección se detiene: la vista filtrada y
 * la sin filtrar no se comportan igual, y el estado del botón "siguiente" es lo
 * que decide si seguimos paginando.
 */
function radiografiarPaginacion(page: Page): Promise<string> {
  return page.evaluate(() => {
    const candidatos = Array.from(
      document.querySelectorAll<HTMLElement>(
        'ul.MuiPagination-ul button, .MuiTablePagination-root button, nav button, [class*="agination"] button',
      ),
    );
    if (candidatos.length === 0) return 'sin controles de paginación en el DOM';

    const botones = candidatos.map((b) => {
      const etiqueta = b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '?';
      const inerte = b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true';
      return `${etiqueta}${inerte ? '[off]' : ''}`;
    });

    // El texto tipo "1-20 de 79" es la única fuente fiable del total.
    const rotulo = document.querySelector('.MuiTablePagination-displayedRows')?.textContent?.trim();
    return `${botones.join(' | ')}${rotulo ? ` :: "${rotulo}"` : ''}`;
  });
}

/**
 * Último número de página que pinta el paginador ("1 … 6 7 8" → 8).
 *
 * Solo se usa para avisar si la recolección acaba antes de tiempo: no gobierna
 * el bucle, que se guía por el botón "siguiente" como corresponde.
 */
function totalPaginas(page: Page): Promise<number> {
  return page.evaluate(() => {
    const numeros = Array.from(
      document.querySelectorAll<HTMLElement>(
        'ul.MuiPagination-ul button, .MuiTablePagination-root button, nav button, [class*="agination"] button',
      ),
    )
      .map((b) => Number.parseInt(b.textContent?.trim() ?? '', 10))
      .filter((n) => Number.isFinite(n));

    return numeros.length > 0 ? Math.max(...numeros) : 0;
  });
}

/**
 * Espera a que el botón "siguiente" quede utilizable.
 *
 * El pie de paginación se repinta después que la tabla: comprobar su estado en
 * cuanto las filas dejan de moverse lo pillaba deshabilitado y la recolección se
 * detenía en la primera página. Si de verdad es la última, esto solo cuesta el
 * plazo corto de espera.
 */
async function esperarSiguienteUtilizable(page: Page): Promise<boolean> {
  const limite = Date.now() + TIMEOUT_PAGINACION;
  const siguiente = page.locator(SELECTORES.listado.siguientePagina).first();

  while (Date.now() < limite) {
    if ((await siguiente.isVisible().catch(() => false)) && !(await siguiente.isDisabled())) {
      return true;
    }
    await page.waitForTimeout(INTERVALO_SONDEO);
  }
  return false;
}

/** Va al listado de actividades, sin pasar por el menú si se puede. */
async function abrirListado(page: Page, urlBase: string, canal: CanalNdjson<unknown>): Promise<void> {
  await page.goto(`${urlBase}${SELECTORES.navegacion.rutaActividades}`, {
    waitUntil: 'domcontentloaded',
  });
  comprobarSesionViva(page);

  const buscador = page.locator(SELECTORES.listado.buscador);
  try {
    await buscador.waitFor({ state: 'visible', timeout: 10_000 });
    return;
  } catch {
    // Si el enlace directo no monta la vista, caemos al recorrido por el menú.
    canal.log('El acceso directo al listado no funcionó; navegando por el menú...');
  }

  await page.locator(SELECTORES.navegacion.menuContenidos).first().click();
  await page.locator(SELECTORES.navegacion.enlaceActividades).first().click();
  await buscador.waitFor({ state: 'visible', timeout: TIMEOUT_ELEMENTO });
}

/**
 * Recolecta todas las actividades cuyo código cuelga de un código padre de libro.
 *
 * Arranca con la sesión ya establecida (`storageState`), así que no repite el
 * login. En lugar de `networkidle` y pausas fijas, se espera al elemento
 * concreto; la única excepción es el refresco de la tabla, que se detecta
 * sondeando su contenido hasta que deja de cambiar (ver `esperarTablaEstable`).
 */
export async function recolectarCodigos(opciones: {
  plataforma: PlataformaId;
  storageState: string;
  codigoLibro: string;
  canal: CanalNdjson<ActividadRef[]>;
}): Promise<ActividadRef[]> {
  const { plataforma, storageState, codigoLibro, canal } = opciones;
  const urlBase = urlBaseDe(plataforma);

  return conNavegador(async (browser) => {
    canal.log(`Iniciando motor de recolección para: ${codigoLibro}...`);

    const context = await crearContextoAutenticado(browser, storageState);
    const page = await context.newPage();

    canal.log('Abriendo el listado de actividades...');
    await abrirListado(page, urlBase, canal);

    canal.log('Buscando el código padre...');
    const buscador = page.locator(SELECTORES.listado.buscador);

    // Huella de la tabla SIN filtrar: es la referencia para saber que el filtro
    // ya se ha aplicado de verdad.
    const huellaSinFiltrar = await huellaTabla(page);

    await buscador.fill(codigoLibro);
    await buscador.press('Enter');
    // Tras buscar, cero resultados es una respuesta válida y no un estado de carga.
    await esperarTablaEstable(page, huellaSinFiltrar, canal, true);

    // El GUID como clave descarta duplicados entre páginas.
    const recolectados = new Map<string, string>();
    let pagina = 1;
    let paginasEsperadas = 0;

    while (pagina <= MAX_PAGINAS) {
      if (canal.cancelado()) {
        canal.log('Recolección cancelada.');
        break;
      }

      canal.log(`Analizando página ${pagina} de resultados...`);
      const filas = await leerFilas(page);

      if (filas.length === 0) {
        canal.log(`No hay elementos en la página ${pagina}. Recolección finalizada.`);
        break;
      }

      for (const { guid, nombre } of filas) {
        if (guid && nombre) recolectados.set(guid, nombre);
      }

      if (pagina === 1) {
        paginasEsperadas = await totalPaginas(page);
        canal.log(
          `Paginación: ${await radiografiarPaginacion(page)}` +
            (paginasEsperadas > 0 ? ` (${paginasEsperadas} páginas)` : ''),
        );
      }

      if (!(await esperarSiguienteUtilizable(page))) {
        canal.log(
          `Última página alcanzada (${recolectados.size} recogidos en ${pagina} página(s)).`,
        );
        break;
      }

      canal.log('Pasando a la siguiente página...');
      const huellaPagina = huellaDe(filas);
      await page.locator(SELECTORES.listado.siguientePagina).first().click();
      await esperarTablaEstable(page, huellaPagina, canal);

      pagina++;
    }

    if (pagina > MAX_PAGINAS) {
      canal.log(`Alcanzado el tope de ${MAX_PAGINAS} páginas: se detiene por seguridad.`);
    }

    // Aviso explícito en lugar de dejar que el hueco se descubra contando en el
    // Excel: es exactamente el fallo que se colaba antes.
    if (paginasEsperadas > 0 && pagina < paginasEsperadas && !canal.cancelado()) {
      canal.log(
        `AVISO: el paginador anunciaba ${paginasEsperadas} páginas y solo se han recorrido ` +
          `${pagina}. El resultado está incompleto.`,
      );
    }

    const todos: ActividadRef[] = Array.from(recolectados, ([guid, nombre]) => ({
      'GUID/ERP': guid,
      Name: nombre,
    }));

    const lista = filtrarPorPrefijo(todos, codigoLibro);

    const descartados = todos.length - lista.length;
    if (descartados > 0) {
      canal.log(
        `Se descartan ${descartados} resultados que no empiezan por ${codigoLibro}.`,
      );
    }

    canal.log(`${lista.length} códigos listos.`);
    return lista;
  });
}
