import { NextResponse } from 'next/server';
import { esPlataformaId } from '@/lib/plataformas';
import { autenticar, CredencialesInvalidasError } from '@/lib/publisher/login';
import { guardarSesion, SesionDemasiadoGrandeError } from '@/lib/session';

// El login abre un Chromium y espera al backoffice: necesita más que el margen por defecto.
export const maxDuration = 120;

/**
 * Valida las credenciales de verdad contra el publisher y sella la sesión.
 *
 * Antes el login era decorativo (`setIsLogged(true)` en el cliente) y las
 * credenciales viajaban en el cuerpo de cada petición de scraping. Ahora la
 * contraseña se usa una vez, aquí, y lo que se guarda es la sesión que devolvió
 * la plataforma.
 */
export async function POST(request: Request) {
  const cuerpo = await request.json().catch(() => null);
  const { usuario, contrasena, plataforma } = cuerpo ?? {};

  if (typeof usuario !== 'string' || !usuario || typeof contrasena !== 'string' || !contrasena) {
    return NextResponse.json({ error: 'Falta el usuario o la contraseña.' }, { status: 400 });
  }
  if (!esPlataformaId(plataforma)) {
    return NextResponse.json({ error: 'Plataforma no válida.' }, { status: 400 });
  }

  try {
    const storageState = await autenticar(plataforma, usuario, contrasena);
    await guardarSesion({ usuario, plataforma, storageState });
    return NextResponse.json({ usuario, plataforma });
  } catch (e) {
    if (e instanceof CredencialesInvalidasError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    if (e instanceof SesionDemasiadoGrandeError) {
      // Las credenciales eran correctas: lo que falla es dónde guardar la sesión.
      return NextResponse.json({ error: e.message }, { status: 413 });
    }
    // Fallo de la plataforma o del navegador, no del usuario.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo iniciar sesión.' },
      { status: 502 },
    );
  }
}
