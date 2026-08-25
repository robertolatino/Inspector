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
 * Hace falta porque el listado es una SPA: al aplicar el filtro las filas
 * antiguas siguen en el DOM un instante. Esperar a "que aparezca una fila" no
 * vale de nada —ya hay filas— y por eso la recolección llegó a devolver
 * actividades de otros libros: se leía la tabla sin filtrar. La versión original
 * lo tapaba durmiendo 3 segundos a ciegas; esto es correcto y además suele
 * resolverse en medio segundo.
 */
async function esperarTablaEstable(
  page: Page,
  huellaPrevia: string,
  canal: CanalNdjson<unknown>,
): Promise<void> {
  const limite = Date.now() + TIMEOUT_ELEMENTO;
  let anterior = '';
  let habiaCambiado = false;

  while (Date.now() < limite) {
    const actual = await huellaTabla(page);

    if (actual !== huellaPrevia) habiaCambiado = true;
    // Dos lecturas iguales seguidas = el refresco ha terminado.
    if (habiaCambiado && actual === anterior) return;

    anterior = actual;
    await page.waitForTimeout(INTERVALO_SONDEO);
  }

  canal.log('Aviso: el listado no ha terminado de refrescarse a tiempo.');
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
    await esperarTablaEstable(page, huellaSinFiltrar, canal);

    // El GUID como clave descarta duplicados entre páginas.
    const recolectados = new Map<string, string>();
    let pagina = 1;

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

      const siguiente = page.locator(SELECTORES.listado.siguientePagina).first();
      if (!(await siguiente.isVisible()) || (await siguiente.isDisabled())) {
        canal.log('Última página alcanzada. Recolección finalizada.');
        break;
      }

      canal.log('Pasando a la siguiente página...');
      const huellaPagina = huellaDe(filas);
      await siguiente.click();
      await esperarTablaEstable(page, huellaPagina, canal);

      pagina++;
    }

    if (pagina > MAX_PAGINAS) {
      canal.log(`Alcanzado el tope de ${MAX_PAGINAS} páginas: se detiene por seguridad.`);
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
