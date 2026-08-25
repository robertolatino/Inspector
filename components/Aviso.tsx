/** Banda de error, con el mismo aspecto en todas las vistas. */
export function Aviso({ mensaje }: { mensaje: string }) {
  if (!mensaje) return null;

  return (
    <div className="p-4 mb-6 bg-red-50 text-red-700 rounded-lg border border-red-200">
      ❌ {mensaje}
    </div>
  );
}

/** Recuadro vacío de "aún no has hecho nada". */
export function Reposo({ icono, texto }: { icono: string; texto: string }) {
  return (
    <div className="border-2 border-dashed border-slate-200 rounded-lg h-64 flex flex-col items-center justify-center text-slate-400">
      <span className="text-2xl mb-2">{icono}</span>
      <p>{texto}</p>
    </div>
  );
}
