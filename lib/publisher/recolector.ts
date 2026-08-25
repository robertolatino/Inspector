import type { Page } from 'playwright';
import type { CanalNdjson } from '../ndjson';
import { urlBaseDe } from '../plataformas';
import type { ActividadRef, PlataformaId } from '../types';
import { comprobarSesionViva } from './login';
import { conNavegador, crearContextoAutenticado } from './navegador';
import { SELECTORES } from './selectores';

/** Tope de seguridad para que una paginación que nunca se deshabilite no cuelgue el proceso. */
const MAX_PAGINAS = 200;
const TIMEOUT_ELEMENTO = 20_000;

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
 * login. Las esperas son por elemento concreto, no `networkidle` + pausas fijas:
 * Playwright desaconseja `networkidle` y en una SPA es a la vez lento y flaky.
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
    await buscador.fill(codigoLibro);
    await buscador.press('Enter');

    // Con resultados aparece al menos una fila; sin resultados no aparece ninguna
    // y el bucle termina en la primera vuelta.
    await page
      .locator(SELECTORES.listado.filaActividad)
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUT_ELEMENTO })
      .catch(() => canal.log('La búsqueda no ha devuelto resultados.'));

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
      const hrefAnterior = filas[0].href;
      await siguiente.click();

      // Esperamos a que la tabla cambie de verdad, en lugar de dormir 2 segundos
      // a ciegas y esperar que haya sido suficiente.
      await page.waitForFunction(
        ([selector, anterior]) => {
          const primera = document.querySelector(selector);
          return !!primera && primera.getAttribute('href') !== anterior;
        },
        [SELECTORES.listado.filaActividad, hrefAnterior] as const,
        { timeout: TIMEOUT_ELEMENTO },
      );

      pagina++;
    }

    if (pagina > MAX_PAGINAS) {
      canal.log(`Alcanzado el tope de ${MAX_PAGINAS} páginas: se detiene por seguridad.`);
    }

    const lista: ActividadRef[] = Array.from(recolectados, ([guid, nombre]) => ({
      'GUID/ERP': guid,
      Name: nombre,
    })).sort((a, b) => a.Name.localeCompare(b.Name, 'es'));

    canal.log(`${lista.length} códigos listos.`);
    return lista;
  });
}
