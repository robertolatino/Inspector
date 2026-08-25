import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { PlataformaId } from './types';

/**
 * Sellado criptográfico de la sesión (AES-256-GCM).
 *
 * Está separado de `session.ts` a propósito: aquí no se importa nada de Next, de
 * modo que estas funciones —que son el control de seguridad de verdad— se pueden
 * ejecutar y testear fuera del framework. `session.ts` se queda con el acceso a
 * las cookies, que sí depende del contexto de la petición.
 *
 * Lo que se sella **no es la contraseña** sino el `storageState` de Playwright,
 * es decir las cookies de sesión que el publisher entregó al hacer login. Así la
 * contraseña solo existe durante la petición de login y, además, cada scrape
 * arranca ya autenticado en lugar de repetir el login.
 */
export interface Sesion {
  usuario: string;
  plataforma: PlataformaId;
  /** `storageState` de Playwright serializado como JSON. */
  storageState: string;
}

/** Tamaño del IV de GCM y de su etiqueta de autenticación, en bytes. */
const BYTES_IV = 12;
const BYTES_TAG = 16;

function clave(): Buffer {
  const secreto = process.env.SESSION_SECRET;
  if (!secreto || secreto.length < 32) {
    // Fallar aquí es preferible a degradar en silencio a un secreto por defecto.
    throw new Error(
      'SESSION_SECRET no está definido o tiene menos de 32 caracteres. ' +
        'Genera uno con: openssl rand -base64 48',
    );
  }
  return createHash('sha256').update(secreto).digest();
}

/** Cifra y comprime la sesión. Devuelve base64url listo para una cookie. */
export function sellar(sesion: Sesion): string {
  const iv = randomBytes(BYTES_IV);
  const cipher = createCipheriv('aes-256-gcm', clave(), iv);
  // El storageState es JSON repetitivo y comprime muy bien: menos trozos de cookie.
  const plano = gzipSync(Buffer.from(JSON.stringify(sesion), 'utf8'));
  const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]).toString('base64url');
}

/**
 * Devuelve null si el sello está manipulado, truncado o se cifró con otro
 * secreto. Rotar `SESSION_SECRET` caduca las sesiones; no las filtra.
 */
export function abrir(sellado: string): Sesion | null {
  try {
    const bruto = Buffer.from(sellado, 'base64url');
    if (bruto.length <= BYTES_IV + BYTES_TAG) return null;

    const decipher = createDecipheriv('aes-256-gcm', clave(), bruto.subarray(0, BYTES_IV));
    decipher.setAuthTag(bruto.subarray(BYTES_IV, BYTES_IV + BYTES_TAG));

    const plano = Buffer.concat([
      decipher.update(bruto.subarray(BYTES_IV + BYTES_TAG)),
      decipher.final(),
    ]);
    return JSON.parse(gunzipSync(plano).toString('utf8')) as Sesion;
  } catch {
    return null;
  }
}
