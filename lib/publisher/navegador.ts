import { chromium, type Browser, type BrowserContext } from 'playwright';

/** Flags necesarios para que Chromium arranque dentro de un contenedor. */
const ARGS_CHROMIUM = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  // Cloud Run da un /dev/shm minúsculo: sin esto Chromium se cae con pestañas en paralelo.
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

const OPCIONES_CONTEXTO = {
  locale: 'es-ES',
  timezoneId: 'Europe/Madrid',
  extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
} as const;

/**
 * Ejecuta `fn` con un navegador y garantiza que se cierra.
 *
 * Todo acceso al publisher debe pasar por aquí: antes el `close()` estaba al
 * final del `try`, así que cualquier excepción dejaba un Chromium huérfano
 * (~200-300 MB) hasta que el contenedor moría por falta de memoria.
 */
export async function conNavegador<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: false, args: ARGS_CHROMIUM });
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {
      /* ya estaba cerrado */
    });
  }
}

/** Contexto anónimo, para el login inicial. */
export function crearContexto(browser: Browser): Promise<BrowserContext> {
  return browser.newContext(OPCIONES_CONTEXTO);
}

/** Forma del `storageState` de Playwright, tomada de la propia librería. */
export type EstadoAlmacen = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * Contexto ya autenticado a partir del `storageState` guardado en la sesión.
 * Evita repetir el login en cada ejecución.
 */
export function crearContextoAutenticado(
  browser: Browser,
  storageState: string | EstadoAlmacen,
): Promise<BrowserContext> {
  return browser.newContext({
    ...OPCIONES_CONTEXTO,
    storageState: typeof storageState === 'string' ? JSON.parse(storageState) : storageState,
  });
}
