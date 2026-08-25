'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PLATAFORMAS_LISTA } from '@/lib/plataformas';
import type { PlataformaId } from '@/lib/types';
import { Aviso } from './Aviso';

/**
 * Formulario de acceso.
 *
 * A diferencia del anterior, este login valida de verdad: el servidor intenta
 * entrar en el publisher con las credenciales y solo entonces abre sesión. La
 * contraseña se envía una vez y no se guarda en ningún estado de React.
 */
export function LoginForm() {
  const router = useRouter();
  const [plataforma, setPlataforma] = useState<PlataformaId>('EPD');
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);

  const acceder = async () => {
    setEntrando(true);
    setError('');

    try {
      const respuesta = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, contrasena, plataforma }),
      });

      if (!respuesta.ok) {
        const datos = await respuesta.json().catch(() => null);
        setError(datos?.error ?? 'No se pudo iniciar sesión.');
        return;
      }

      // La página es un Server Component: al refrescar lee la cookie y pinta el panel.
      router.refresh();
    } catch {
      setError('Error de conexión con el servidor.');
    } finally {
      setEntrando(false);
    }
  };

  const puedeEnviar = usuario.trim() !== '' && contrasena !== '' && !entrando;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form
        className="bg-white p-10 rounded-lg shadow-md max-w-md w-full border border-slate-200"
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeEnviar) acceder();
        }}
      >
        <div className="flex justify-center mb-6">
          <div className="bg-[#2a40b3] text-white p-3 rounded-xl font-bold text-2xl">EDV</div>
        </div>
        <h1 className="text-2xl font-bold text-center text-slate-800 mb-2">Inspector</h1>
        <p className="text-sm text-center text-slate-500 mb-8">
          Inicia sesión con tus credenciales del backoffice
        </p>

        <Aviso mensaje={error} />

        <div className="space-y-4">
          <div>
            <label htmlFor="plataforma" className="block text-sm font-medium text-slate-700 mb-1">
              Plataforma
            </label>
            <select
              id="plataforma"
              className="w-full p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2a40b3]"
              value={plataforma}
              onChange={(e) => setPlataforma(e.target.value as PlataformaId)}
              disabled={entrando}
            >
              {PLATAFORMAS_LISTA.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="usuario" className="block text-sm font-medium text-slate-700 mb-1">
              Usuario
            </label>
            <input
              id="usuario"
              type="email"
              autoComplete="username"
              placeholder="correo@edelvives.es"
              className="w-full p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2a40b3]"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              disabled={entrando}
            />
          </div>

          <div>
            <label htmlFor="contrasena" className="block text-sm font-medium text-slate-700 mb-1">
              Contraseña
            </label>
            <input
              id="contrasena"
              type="password"
              autoComplete="current-password"
              className="w-full p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2a40b3]"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              disabled={entrando}
            />
          </div>

          <button
            type="submit"
            className="w-full bg-[#2a40b3] hover:bg-[#1e2e85] text-white font-medium py-2 px-4 rounded-md transition-colors mt-4 disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            disabled={!puedeEnviar}
          >
            {entrando ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                <span>Comprobando credenciales...</span>
              </>
            ) : (
              <span>Acceder</span>
            )}
          </button>
        </div>
      </form>
    </main>
  );
}
