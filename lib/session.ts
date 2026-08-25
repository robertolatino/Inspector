import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { cookies } from 'next/headers';
import type { PlataformaId } from './types';

/**
 * Sesión sellada en cookie.
 *
 * Lo que se guarda **no es la contraseña** sino el `storageState` de Playwright,
 * es decir las cookies de sesión que el publisher entregó al hacer login. Con
 * eso la contraseña solo existe durante la petición de login y, además, cada
 * scrape arranca ya autenticado en lugar de repetir el login (~10 s y un punto
 * de fallo menos por ejecución).
 *
 * El sellado es AES-256-GCM: la cookie es ilegible e infalsificable para el
 * cliente, y `abrir()` devuelve null si alguien la manipula o si se rota el
 * secreto.
 */
export interface Sesion {
  usuario: string;
  plataforma: PlataformaId;
  /** `storageState` de Playwright serializado como JSON. */
  storageState: string;
}

const NOMBRE_COOKIE = 'edv_sesion';
/** Margen por debajo del límite de ~4096 bytes por cookie de los navegadores. */
const MAX_BYTES_TROZO = 3500;
/** Tope de trozos: también es el rango que se limpia al escribir o cerrar sesión. */
const MAX_TROZOS = 8;
const DURACION_SEGUNDOS = 8 * 60 * 60;

function clave(): Buffer {
  const secreto = process.env.SESSION_SECRET;
  if (!secreto || secreto.length < 32) {
    // Fallar aquí es preferible a degradar en silencio a un secreto por defecto.
    throw new Error(
      'SESSION_SECRET no está definido o tiene menos de 32 caracteres. ' +
        'Genera uno con: openssl rand -base64 32',
    );
  }
  return createHash('sha256').update(secreto).digest();
}

/** Cifra y comprime la sesión. Devuelve base64url listo para una cookie. */
export function sellar(sesion: Sesion): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', clave(), iv);
  // El storageState es JSON repetitivo y comprime muy bien: menos trozos de cookie.
  const plano = gzipSync(Buffer.from(JSON.stringify(sesion), 'utf8'));
  const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]).toString('base64url');
}

/** Devuelve null si el sello es inválido, está manipulado o el secreto cambió. */
export function abrir(sellado: string): Sesion | null {
  try {
    const bruto = Buffer.from(sellado, 'base64url');
    if (bruto.length <= 28) return null;

    const decipher = createDecipheriv('aes-256-gcm', clave(), bruto.subarray(0, 12));
    decipher.setAuthTag(bruto.subarray(12, 28));
    const plano = Buffer.concat([decipher.update(bruto.subarray(28)), decipher.final()]);
    return JSON.parse(gunzipSync(plano).toString('utf8')) as Sesion;
  } catch {
    return null;
  }
}

function partir(texto: string): string[] {
  const trozos: string[] = [];
  for (let i = 0; i < texto.length; i += MAX_BYTES_TROZO) {
    trozos.push(texto.slice(i, i + MAX_BYTES_TROZO));
  }
  return trozos;
}

/**
 * Escribe la sesión repartida en cookies numeradas: el storageState del
 * publisher puede pasar del límite de 4 KB de una sola cookie.
 */
export async function guardarSesion(sesion: Sesion): Promise<void> {
  const trozos = partir(sellar(sesion));
  if (trozos.length > MAX_TROZOS) {
    throw new Error(`La sesión no cabe en ${MAX_TROZOS} cookies (${trozos.length} trozos).`);
  }

  const store = await cookies();
  const opciones = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: DURACION_SEGUNDOS,
  };

  for (let i = 0; i < MAX_TROZOS; i++) {
    const nombre = `${NOMBRE_COOKIE}.${i}`;
    // Sobrescribir solo los trozos nuevos dejaría cola de una sesión anterior más larga.
    if (i < trozos.length) store.set(nombre, trozos[i], opciones);
    else store.delete(nombre);
  }
}

export async function leerSesion(): Promise<Sesion | null> {
  const store = await cookies();
  let sellado = '';

  for (let i = 0; i < MAX_TROZOS; i++) {
    const trozo = store.get(`${NOMBRE_COOKIE}.${i}`)?.value;
    if (!trozo) break;
    sellado += trozo;
  }

  return sellado ? abrir(sellado) : null;
}

export async function borrarSesion(): Promise<void> {
  const store = await cookies();
  for (let i = 0; i < MAX_TROZOS; i++) store.delete(`${NOMBRE_COOKIE}.${i}`);
}

/** Nombre del primer trozo: lo usa `proxy.ts` para el chequeo barato de presencia. */
export const COOKIE_SESION_PRIMER_TROZO = `${NOMBRE_COOKIE}.0`;
