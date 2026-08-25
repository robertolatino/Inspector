import { cookies } from 'next/headers';
import { abrir, sellar, type Sesion } from './sello';

/**
 * Acceso a la sesión desde las cookies de la petición.
 *
 * El sellado criptográfico vive en `lib/sello.ts`, que no depende de Next y está
 * cubierto por tests. Aquí solo queda el reparto en cookies.
 */
export type { Sesion };

const NOMBRE_COOKIE = 'edv_sesion';
/** Margen por debajo del límite de ~4096 bytes por cookie de los navegadores. */
const MAX_BYTES_TROZO = 3500;
/** Tope de trozos: también es el rango que se limpia al escribir o cerrar sesión. */
const MAX_TROZOS = 8;
const DURACION_SEGUNDOS = 8 * 60 * 60;

/** Nombre del primer trozo: lo usa `proxy.ts` para el chequeo barato de presencia. */
export const COOKIE_SESION_PRIMER_TROZO = `${NOMBRE_COOKIE}.0`;

function partir(texto: string): string[] {
  const trozos: string[] = [];
  for (let i = 0; i < texto.length; i += MAX_BYTES_TROZO) {
    trozos.push(texto.slice(i, i + MAX_BYTES_TROZO));
  }
  return trozos;
}

/**
 * Escribe la sesión repartida en cookies numeradas: el `storageState` del
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
