import type { Browser } from 'playwright';
import { crearContextoAutenticado, type EstadoAlmacen } from './navegador';
import { SELECTORES } from './selectores';

/**
 * Adelgazamiento del `storageState` de la plataforma.
 *
 * El publisher devuelve un estado enorme: medido en EPD, **118 KB**, que sellados
 * son 22 KB — muy por encima de lo que cabe en cookies (el límite real no es el
 * de 4 KB por cookie sino el del total de cabeceras: Node responde 431 por
 * encima de 16 KB, y el navegador reenvía todas las cookies en cada petición).
 *
 * Casi todo ese peso es estado de Redux-persist de la propia aplicación
 * (`persist:scopes` solo son 32 KB) más una clave de analítica de PostHog: nada
 * que tenga que ver con la autenticación. Medido en EPD, quedarse con la cookie
 * y las claves que parecen de sesión lo baja a **4,4 KB** — un 96 % menos, y un
 * único trozo de cookie.
 *
 * Lo que NO se hace es adivinar. El recorte **se valida de verdad** abriendo un
 * contexto nuevo con él y comprobando que sigue entrando en el backoffice, así
 * que un filtro que dejara de capturar lo esencial se detecta al iniciar sesión
 * y no a mitad de una extracción.
 *
 * (Con solo las cookies no basta: en EPD son 490 B y no autentican. Hace falta
 * al menos una clave de `localStorage`.)
 */

/**
 * Un recorte que sirve entra en pocos segundos; solo los que fallan agotan el
 * plazo. Se queda corto a propósito: con dos candidatos, el peor caso más el
 * login tiene que caber en el `maxDuration` de la ruta (60 s).
 */
const TIMEOUT_VALIDACION = 12_000;

/** Claves de `localStorage` que parecen sostener la sesión. */
const PATRON_CLAVE_SESION = /token|auth|session|sesion|jwt|credential|user|usuario|login/i;
/** Un token es corto; una caché de contenidos no. */
const MAX_BYTES_VALOR = 8_000;

function bytes(estado: EstadoAlmacen): number {
  return JSON.stringify(estado).length;
}

/** Cookies más las claves de `localStorage` que pintan a sesión y son pequeñas. */
function cookiesYClavesDeSesion(completo: EstadoAlmacen): EstadoAlmacen {
  return {
    cookies: completo.cookies,
    origins: completo.origins
      .map((origen) => ({
        origin: origen.origin,
        localStorage: origen.localStorage.filter(
          (entrada) =>
            PATRON_CLAVE_SESION.test(entrada.name) && entrada.value.length <= MAX_BYTES_VALOR,
        ),
      }))
      .filter((origen) => origen.localStorage.length > 0),
  };
}

/** Abre un contexto con el estado dado y comprueba que sigue autenticado. */
async function sigueAutenticado(
  browser: Browser,
  estado: EstadoAlmacen,
  urlBase: string,
): Promise<boolean> {
  const context = await crearContextoAutenticado(browser, estado);
  try {
    const page = await context.newPage();
    await page.goto(`${urlBase}${SELECTORES.navegacion.rutaActividades}`, {
      waitUntil: 'domcontentloaded',
    });
    await page
      .locator(SELECTORES.marcadorSesion)
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUT_VALIDACION });

    // Si nos ha rebotado al login, el recorte no sirve.
    return !page.url().includes(SELECTORES.login.ruta);
  } catch {
    return false;
  } finally {
    await context.close().catch(() => {
      /* ya estaba cerrado */
    });
  }
}

/** Deja en el log las claves más gordas: es lo que explica el tamaño. */
function registrarDesglose(completo: EstadoAlmacen): void {
  const claves = completo.origins
    .flatMap((origen) => origen.localStorage)
    .map((entrada) => ({ nombre: entrada.name, bytes: entrada.value.length }))
    .sort((a, b) => b.bytes - a.bytes);

  console.info(
    '[sesion] estado completo=%d B: %d cookies, %d claves de localStorage',
    bytes(completo),
    completo.cookies.length,
    claves.length,
  );
  for (const clave of claves.slice(0, 8)) {
    console.info('[sesion]   %d B  %s', clave.bytes, clave.nombre);
  }
}

/**
 * Devuelve un estado lo bastante pequeño para caber en una cookie, siempre que
 * se haya comprobado que sigue autenticando.
 *
 * Si el recorte no vale, se devuelve el estado completo: la capa de sesión lo
 * rechazará por tamaño y el usuario verá un error claro en el login. Es
 * deliberado — preferimos fallar al entrar que guardar una sesión rota y
 * descubrirlo a mitad de una extracción de media hora.
 */
export async function reducirEstadoSesion(
  browser: Browser,
  completo: EstadoAlmacen,
  urlBase: string,
): Promise<EstadoAlmacen> {
  registrarDesglose(completo);

  const recortado = cookiesYClavesDeSesion(completo);
  const conservadas = recortado.origins.flatMap((origen) =>
    origen.localStorage.map((entrada) => entrada.name),
  );

  if (bytes(recortado) < bytes(completo) && (await sigueAutenticado(browser, recortado, urlBase))) {
    console.info(
      '[sesion] recorte válido: %d B (%d cookies + %d claves: %s)',
      bytes(recortado),
      recortado.cookies.length,
      conservadas.length,
      conservadas.join(', ') || 'ninguna',
    );
    return recortado;
  }

  console.warn(
    '[sesion] el recorte no autentica (%d B, claves: %s); se devuelve el estado completo. ' +
      'Revisa PATRON_CLAVE_SESION en lib/publisher/estadoSesion.ts.',
    bytes(recortado),
    conservadas.join(', ') || 'ninguna',
  );
  return completo;
}
