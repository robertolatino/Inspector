'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { useEstadoPersistido } from '@/hooks/useEstadoPersistido';
import { useNdjsonStream } from '@/hooks/useNdjsonStream';
import type { ActividadRef } from '@/lib/types';
import { Aviso, Reposo } from './Aviso';
import { Terminal } from './Terminal';

/** Referencia estable: `useEstadoPersistido` compara identidades. */
const SIN_CODIGOS: ActividadRef[] = [];

/** Paso 1: buscar un código padre de libro y recolectar sus actividades. */
export function RecolectorView() {
  const [codigoPadre, setCodigoPadre] = useState('');
  const [codigos, setCodigos] = useEstadoPersistido<ActividadRef[]>(
    'inspector.codigos',
    SIN_CODIGOS,
  );
  const { logs, error, ejecutando, ejecutar, cancelar } = useNdjsonStream<ActividadRef[]>();

  const recolectar = async () => {
    setCodigos([]);
    const resultado = await ejecutar('/api/recolector', { codigoLibro: codigoPadre.trim() });
    if (resultado) setCodigos(resultado);
  };

  const descargarExcel = () => {
    if (codigos.length === 0) return;

    const hoja = XLSX.utils.json_to_sheet(codigos);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Hotspots');
    XLSX.writeFile(libro, `export_hotspots_${codigoPadre.trim() || 'actividades'}.xlsx`);
  };

  return (
    <div className="w-full bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
      <div className="flex items-end space-x-4 mb-8">
        <div className="flex-1">
          <label htmlFor="codigoPadre" className="block text-sm font-medium text-slate-700 mb-1">
            Código Padre del Libro
          </label>
          <input
            id="codigoPadre"
            type="text"
            placeholder="Ej: 225253_MAT1"
            className="w-full p-2 border border-slate-300 rounded-md focus:outline-none focus:border-[#2a40b3]"
            value={codigoPadre}
            onChange={(e) => setCodigoPadre(e.target.value)}
            disabled={ejecutando}
          />
        </div>

        {ejecutando ? (
          <button
            onClick={cancelar}
            className="border border-slate-300 text-slate-700 px-6 py-2 rounded-md font-medium hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
        ) : null}

        <button
          onClick={recolectar}
          disabled={ejecutando || codigoPadre.trim() === ''}
          className="bg-[#2a40b3] text-white px-6 py-2 rounded-md font-medium hover:bg-[#1e2e85] transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center space-x-2"
        >
          {ejecutando ? (
            <>
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              <span>Recolectando...</span>
            </>
          ) : (
            <span>Buscar contenidos</span>
          )}
        </button>
      </div>

      <Aviso mensaje={error} />

      {ejecutando ? (
        <Terminal logs={logs} />
      ) : codigos.length > 0 ? (
        <div className="space-y-6">
          <div className="border-2 border-dashed border-emerald-300 bg-emerald-50 rounded-lg p-8 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 bg-emerald-500 text-white rounded-md flex items-center justify-center text-2xl mb-3 shadow-sm">
              ✓
            </div>
            <h3 className="text-emerald-800 font-bold text-lg">¡Recolección completada!</h3>
            <p className="text-emerald-600 mb-6">Se han extraído {codigos.length} códigos</p>

            <button
              onClick={descargarExcel}
              className="bg-emerald-600 text-white px-6 py-2 rounded-md font-medium hover:bg-emerald-700 transition-colors shadow-sm flex items-center space-x-2"
            >
              <span className="text-lg">📊</span>
              <span>Descargar Excel</span>
            </button>
          </div>

          <div className="border border-slate-200 rounded-lg">
            <div className="bg-slate-50 p-3 border-b border-slate-200 text-sm font-medium text-slate-700">
              Vista previa
            </div>
            <div className="p-4 h-48 overflow-y-auto bg-slate-50/50 font-mono text-sm space-y-2">
              {codigos.map((item) => (
                <div
                  key={item['GUID/ERP']}
                  className="py-2 border-b border-slate-200 last:border-0 flex flex-col"
                >
                  <span className="font-bold text-[#2a40b3]">{item.Name}</span>
                  <span className="text-xs text-slate-500 truncate">{item['GUID/ERP']}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Reposo icono="🔍" texto="Introduce un código para comenzar la recolección" />
      )}
    </div>
  );
}
