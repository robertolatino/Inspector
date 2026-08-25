import { NextResponse } from 'next/server';
import { respuestaNdjson } from '@/lib/ndjson';
import { extraerEnunciados } from '@/lib/publisher/extractor';
import { leerSesion } from '@/lib/session';
import { esActividadRef, type EnunciadoExtraido } from '@/lib/types';

// El scrape vive dentro de la petición: sin esto la plataforma la corta antes de terminar.
export const maxDuration = 3600;

/** Tope defensivo: nadie revisa 5.000 actividades de una vez a mano. */
const MAX_ACTIVIDADES = 5000;

/**
 * Extrae los enunciados de una lista de actividades.
 *
 * La ruta solo valida la entrada y delega: el motor está en
 * `lib/publisher/extractor`.
 */
export async function POST(request: Request) {
  const sesion = await leerSesion();
  if (!sesion) {
    return NextResponse.json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' }, { status: 401 });
  }

  const cuerpo = await request.json().catch(() => null);
  const recibidas: unknown = cuerpo?.actividades;

  if (!Array.isArray(recibidas) || recibidas.length === 0) {
    return NextResponse.json({ error: 'La lista de actividades está vacía.' }, { status: 400 });
  }
  if (recibidas.length > MAX_ACTIVIDADES) {
    return NextResponse.json(
      { error: `Demasiadas actividades (máximo ${MAX_ACTIVIDADES}).` },
      { status: 413 },
    );
  }

  // Nos quedamos solo con las filas bien formadas y descartamos el resto de
  // columnas del Excel (Position, Type, Page...).
  const actividades = recibidas.filter(esActividadRef).map((fila) => ({
    'GUID/ERP': fila['GUID/ERP'],
    Name: fila.Name,
  }));

  if (actividades.length === 0) {
    return NextResponse.json(
      { error: 'Ninguna fila tiene las columnas GUID/ERP y Name.' },
      { status: 400 },
    );
  }

  return respuestaNdjson<EnunciadoExtraido[]>(request.signal, async (canal) => {
    if (actividades.length < recibidas.length) {
      canal.log(`Se han descartado ${recibidas.length - actividades.length} filas sin GUID/ERP o Name.`);
    }

    canal.exito(
      await extraerEnunciados({
        plataforma: sesion.plataforma,
        storageState: sesion.storageState,
        actividades,
        canal,
      }),
    );
  });
}
