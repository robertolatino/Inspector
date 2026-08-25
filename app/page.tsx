import { Dashboard } from '@/components/Dashboard';
import { LoginForm } from '@/components/LoginForm';
import { leerSesion } from '@/lib/session';

/**
 * Server Component: la sesión se lee y se verifica en el servidor, así que el
 * panel no llega al navegador si no hay una cookie válida.
 *
 * Antes esta decisión la tomaba el propio cliente con un `setIsLogged(true)`
 * que no comprobaba nada.
 */
export default async function Home() {
  const sesion = await leerSesion();

  if (!sesion) return <LoginForm />;

  return <Dashboard usuario={sesion.usuario} plataforma={sesion.plataforma} />;
}
