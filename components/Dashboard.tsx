'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PLATAFORMAS } from '@/lib/plataformas';
import type { PlataformaId } from '@/lib/types';
import { AnalistaPlaceholder } from './AnalistaPlaceholder';
import { ExtractorView } from './ExtractorView';
import { RecolectorView } from './RecolectorView';

type Vista = 'recolector' | 'extractor' | 'analista';

const VISTAS: { id: Vista; etiqueta: string; titulo: string }[] = [
  { id: 'recolector', etiqueta: 'Recolección', titulo: 'Búsqueda y Recolección de Códigos' },
  { id: 'extractor', etiqueta: 'Extracción', titulo: 'Extracción de Enunciados' },
  { id: 'analista', etiqueta: 'Análisis IA (Próximamente)', titulo: 'Copiloto de Revisión Editorial' },
];

export function Dashboard({
  usuario,
  plataforma,
}: {
  usuario: string;
  plataforma: PlataformaId;
}) {
  const router = useRouter();
  const [vista, setVista] = useState<Vista>('recolector');
  const actual = VISTAS.find((v) => v.id === vista) ?? VISTAS[0];

  const salir = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    sessionStorage.clear();
    router.refresh();
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      <aside className="w-16 md:w-64 bg-[#232b62] text-white flex flex-col transition-all duration-300">
        <div className="h-16 flex items-center justify-center border-b border-indigo-800/50">
          <span className="font-bold text-xl tracking-wider hidden md:block">INSPECTOR</span>
          <span className="font-bold text-xl block md:hidden">IN</span>
        </div>

        <nav className="flex-1 py-6 space-y-2 px-3">
          {VISTAS.map((v) => (
            <button
              key={v.id}
              onClick={() => setVista(v.id)}
              className={`w-full flex items-center space-x-3 p-3 rounded-lg transition-colors ${
                vista === v.id
                  ? 'bg-[#2a40b3] text-white'
                  : 'text-indigo-200 hover:bg-indigo-800/50'
              }`}
            >
              <span className="hidden md:block font-medium text-left">{v.etiqueta}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-indigo-800/50">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-sm font-bold shrink-0">
              {usuario.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="hidden md:block overflow-hidden">
              <p className="text-sm font-medium truncate">{usuario}</p>
              <p className="text-xs text-indigo-300 truncate">{PLATAFORMAS[plataforma].nombre}</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8">
          <h2 className="text-xl font-semibold text-slate-800">{actual.titulo}</h2>

          {/*
            La plataforma se muestra, no se elige: se fija al iniciar sesión.
            El selector que había aquí permitía cambiarla a media sesión, lo que
            dejaba la sesión del publisher apuntando a la plataforma equivocada.
          */}
          <div className="flex items-center space-x-4">
            <span className="text-sm text-slate-500">{PLATAFORMAS[plataforma].nombre}</span>
            <button
              onClick={salir}
              className="text-sm text-slate-600 border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50 transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          {vista === 'recolector' && <RecolectorView />}
          {vista === 'extractor' && <ExtractorView />}
          {vista === 'analista' && <AnalistaPlaceholder />}
        </div>
      </main>
    </div>
  );
}
