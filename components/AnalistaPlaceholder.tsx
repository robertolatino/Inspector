/**
 * Maqueta del futuro copiloto de revisión editorial.
 *
 * No está implementado: la fila de la tabla es un ejemplo fijo y el botón no
 * hace nada. Se mantiene como referencia visual de hacia dónde va la vista.
 */
export function AnalistaPlaceholder() {
  return (
    <div className="w-full bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
        Vista de ejemplo: el análisis con IA todavía no está implementado.
      </div>

      <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
        <select className="p-2 text-sm border border-slate-300 rounded-md focus:outline-none" disabled>
          <option>Criterio: Libro de Matemáticas (6 años)</option>
          <option>Criterio: Libro de Lengua (10 años)</option>
        </select>
        <button
          className="bg-slate-300 text-white px-4 py-2 text-sm rounded-md font-medium cursor-not-allowed"
          disabled
        >
          Ejecutar Revisión IA
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-sm border-b border-slate-200">
              <th className="p-4 font-medium">Código</th>
              <th className="p-4 font-medium w-1/3">Enunciado Original</th>
              <th className="p-4 font-medium w-1/3">Sugerencia IA</th>
              <th className="p-4 font-medium">Motivo y Acción</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            <tr className="border-b border-slate-100">
              <td className="p-4 font-medium text-slate-700">U01_ACT05</td>
              <td className="p-4 text-slate-600">
                Calculad el resultado de las siguientes operaciones y escribidlos abajo.
              </td>
              <td className="p-4 text-emerald-700 font-medium bg-emerald-50/50">
                Calcula el resultado de las operaciones y escríbelo.
              </td>
              <td className="p-4">
                <span className="inline-block px-2 py-1 bg-amber-100 text-amber-800 text-xs rounded-md mb-2">
                  Voz / Edad
                </span>
                <p className="text-xs text-slate-500">
                  Para 6 años, el manual indica usar 2ª persona del singular (tú), no plural
                  (vosotros).
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
