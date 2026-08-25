import type { Page } from 'playwright';
import { urlBaseDe } from '../plataformas';
import type { PlataformaId } from '../types';
import { conNavegador, crearContexto } from './navegador';
import { SELECTORES } from './selectores';

const TIMEOUT_LOGIN = 20_000;

/** La plataforma rechazó usuario/contraseña. */
export class CredencialesInvalidasError extends Error {
  constructor() {
    super('Usuario o contraseña incorrectos.');
    this.name = 'CredencialesInvalidasError';
  }
}

/** El storageState guardado ya no vale: hay que volver a iniciar sesión. */
export class SesionCaducadaError extends Error {
  constructor() {
    super('La sesión con la plataforma ha caducado. Vuelve a iniciar sesión.');
    this.name = 'SesionCaducadaError';
  }
}

/**
 * Hace login de verdad contra el publisher y devuelve el `storageState`
 * serializado (las cookies de sesión de la plataforma).
 *
 * La contraseña solo vive durante esta llamada: no se guarda ni se vuelve a
 * enviar. Antes el login de la app no validaba nada y una contraseña incorrecta
 * se manifestaba mucho después como un timeout de selector incomprensible.
 */
export async function autenticar(
  plataforma: PlataformaId,
  usuario: string,
  contrasena: string,
): Promise<string> {
  const urlBase = urlBaseDe(plataforma);

  return conNavegador(async (browser) => {
    const context = await crearContexto(browser);
    const page = await context.newPage();

    await page.goto(`${urlBase}${SELECTORES.login.ruta}`, { waitUntil: 'domcontentloaded' });
    await page.locator(SELECTORES.login.usuario).first().fill(usuario);
    await page.locator(SELECTORES.login.contrasena).first().fill(contrasena);
    await page.locator(SELECTORES.login.enviar).first().click();

    try {
      await page
        .locator(SELECTORES.marcadorSesion)
        .first()
        .waitFor({ state: 'visible', timeout: TIMEOUT_LOGIN });
    } catch {
      // Distinguimos los dos motivos sin depender del selector del mensaje de
      // error, que es lo más volátil de la página: si seguimos en la pantalla
      // de login, las credenciales se rechazaron.
      if (page.url().includes(SELECTORES.login.ruta)) throw new CredencialesInvalidasError();
      throw new Error(
        'El login se aceptó pero no se reconoce el backoffice. Es probable que la plataforma haya cambiado.',
      );
    }

    return JSON.stringify(await context.storageState());
  });
}

/**
 * Comprueba que la navegación no ha acabado rebotando al login. Se llama tras
 * el primer `goto` de cada motor para fallar con un mensaje claro en lugar de
 * con un timeout de selector.
 */
export function comprobarSesionViva(page: Page): void {
  if (page.url().includes(SELECTORES.login.ruta)) throw new SesionCaducadaError();
}
