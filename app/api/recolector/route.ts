import { NextResponse } from 'next/server';
import { respuestaNdjson } from '@/lib/ndjson';
import { recolectarCodigos } from '@/lib/publisher/recolector';
import { leerSesion } from '@/lib/session';
import type { ActividadRef } from '@/lib/types';

// El scrape vive dentro de la petición: sin esto la plataforma la corta antes de terminar.
export const maxDuration = 3600;

/**
 * Recolecta los códigos de actividad de un libro.
 *
 * La ruta solo valida la entrada y delega: el motor está en
 * `lib/publisher/recolector`. Ya no recibe credenciales ni `url_base` — la
 * sesión y la plataforma salen de la cookie sellada.
 */
export async function POST(request: Request) {
  const sesion = await leerSesion();
  if (!sesion) {
    return NextResponse.json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' }, { status: 401 });
  }

  const cuerpo = await request.json().catch(() => null);
  const codigoLibro = typeof cuerpo?.codigoLibro === 'string' ? cuerpo.codigoLibro.trim() : '';

  if (!codigoLibro) {
    return NextResponse.json({ error: 'Falta el código del libro.' }, { status: 400 });
  }

  return respuestaNdjson<ActividadRef[]>(request.signal, async (canal) => {
    canal.exito(
      await recolectarCodigos({
        plataforma: sesion.plataforma,
        storageState: sesion.storageState,
        codigoLibro,
        canal,
      }),
    );
  });
}
