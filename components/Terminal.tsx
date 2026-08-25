'use client';

import { useEffect, useRef } from 'react';

/** Terminal de progreso con auto-scroll. Antes estaba duplicada en las dos vistas. */
export function Terminal({ logs }: { logs: string[] }) {
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contenedor.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="bg-slate-900 rounded-lg p-6 flex flex-col h-72 shadow-inner border border-slate-800">
      <div
        ref={contenedor}
        className="flex-1 overflow-y-auto font-mono text-sm text-green-400 space-y-1 pr-2"
      >
        {logs.map((log, index) => (
          <div key={index} className="opacity-90">
            {log}
          </div>
        ))}
        <div className="animate-pulse opacity-70 mt-2">_</div>
      </div>
    </div>
  );
}
