import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_SESION_PRIMER_TROZO } from '@/lib/session';

/**
 * Puerta de entrada.
 *
 * En Next 16 el convenio `middleware` está deprecado y se llama `proxy`.
 *
 * OJO: esto NO es la frontera de seguridad, solo una comprobación barata de
 * presencia de cookie para que el usuario no vea una pantalla que no puede usar.
 * La verificación criptográfica de verdad la hacen las rutas con `leerSesion()`,
 * que devuelve null ante una cookie manipulada; el proxy corre en un runtime
 * donde no conviene depender de `node:crypto`.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // El propio login y el logout tienen que ser accesibles sin sesión.
  if (pathname.startsWith('/api/auth/')) return NextResponse.next();

  if (request.cookies.has(COOKIE_SESION_PRIMER_TROZO)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sesión no iniciada.' }, { status: 401 });
  }

  // La página se sirve igual: al no haber sesión renderiza el formulario de login.
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/api/:path*'],
};
