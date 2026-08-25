'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { useEstadoPersistido } from '@/hooks/useEstadoPersistido';
import { useNdjsonStream } from '@/hooks/useNdjsonStream';
import { esActividadRef, type ActividadRef, type EnunciadoExtraido } from '@/lib/types';
import { Aviso, Reposo } from './Aviso';
import { Terminal } from './Terminal';

/** Referencia estable: `useEstadoPersistido` compara identidades. */
const SIN_ENUNCIADOS: EnunciadoExtraido[] = [];

/** Paso 2: subir el Excel de actividades y extraer sus enunciados. */
export function ExtractorView() {
  const [actividades, setActividades] = useState<ActividadRef[]>([]);
  const [enunciados, setEnunciados] = useEstadoPersistido<EnunciadoExtraido[]>(
    'inspector.enunciados',
    SIN_ENUNCIADOS,
  );
  const [errorLocal, setErrorLocal] = useState('');
  const { logs, error, ejecutando, ejecutar, cancelar } = useNdjsonStream<EnunciadoExtraido[]>();

  const cargarExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;

    const lector = new FileReader();
    lector.onload = (evento) => {
      try {
        const libro = XLSX.read(new Uint8Array(evento.target?.result as ArrayBuffer), {
          type: 'array',
        });
        const hoja = libro.Sheets[libro.SheetNames[0]];
        const filas: unknown[] = XLSX.utils.sheet_to_json(hoja);

        // Nos quedamos con las columnas clave e ignoramos el resto (Position, Type, Page...).
        const validas = filas.filter(esActividadRef).map((fila) => ({
          'GUID/ERP': fila['GUID/ERP'],
          Name: fila.Name,
        }));

        if (validas.length === 0) {
          setErrorLocal('El Excel no tiene ninguna fila con las columnas GUID/ERP y Name.');
          setActividades([]);
          return;
        }

        setActividades(validas);
        setErrorLocal(
          validas.length < filas.length
            ? `Se han descartado ${filas.length - validas.length} filas sin GUID/ERP o Name.`
            : '',
        );
      } catch {
        setErrorLocal('No se pudo leer el Excel. Comprueba que el archivo no esté dañado.');
        setActividades([]);
      }
    };
    lector.readAsArrayBuffer(archivo);
  };

  const extraer = async () => {
    setEnunciados([]);
    const resultado = await ejecutar('/api/extractor', { actividades });
    if (resultado) setEnunciados(resultado);
  };

  const descargarWord = async () => {
    setErrorLocal('');

    try {
      const respuesta = await fetch('/api/generar-word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enunciados }),
      });

      if (!respuesta.ok) {
        const datos = await respuesta.json().catch(() => null);
        setErrorLocal(datos?.error ?? 'Error al generar el documento Word.');
        return;
      }

      const url = URL.createObjectURL(await respuesta.blob());
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'Enunciados_Edelvives.docx';
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
    } catch {
      setErrorLocal('Hubo un problema al generar el archivo Word.');
    }
  };

  return (
    <div className="w-full bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="relative">
          <input
            type="file"
            accept=".xlsx"
            onChange={cargarExcel}
            disabled={ejecutando}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
          <div
            className={`border-2 border-dashed rounded-lg p-4 flex items-center space-x-4 transition-colors ${
              actividades.length > 0
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-[#2a40b3]/30 bg-[#2a40b3]/5 hover:bg-[#2a40b3]/10'
            }`}
          >
            <div>
              <p className="text-slate-700 font-medium">
                {actividades.length > 0
                  ? `Archivo cargado: ${actividades.length} códigos listos`
                  : 'Seleccionar archivo .xlsx'}
              </p>
              <p className="text-sm text-slate-500">
                Sube el archivo generado en el paso anterior o el extraído desde Tangerine
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {ejecutando ? (
            <button
              onClick={cancelar}
              className="border border-slate-300 text-slate-700 px-6 py-3 rounded-md font-medium hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
          ) : null}

          <button
            onClick={extraer}
            disabled={ejecutando || actividades.length === 0}
            className="bg-[#2a40b3] text-white px-6 py-3 rounded-md font-medium hover:bg-[#1e2e85] transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {ejecutando ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                <span>Extrayendo...</span>
              </>
            ) : (
              <span>Iniciar</span>
            )}
          </button>
        </div>
      </div>

      <Aviso mensaje={error || errorLocal} />

      {ejecutando ? (
        <Terminal logs={logs} />
      ) : enunciados.length > 0 ? (
        <div className="space-y-6">
          <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-6 flex justify-between items-center">
            <div>
              <h3 className="text-emerald-800 font-bold text-lg flex items-center">
                <span className="mr-2">✓</span> Extracción completada
              </h3>
              <p className="text-emerald-600">
                Se han extraído {enunciados.length} enunciados con éxito.
              </p>
            </div>
            <button
              onClick={descargarWord}
              className="bg-emerald-600 text-white px-4 py-2 rounded-md font-medium hover:bg-emerald-700 transition-colors shadow-sm"
            >
              Descargar Word (.docx)
            </button>
          </div>

          <div className="border border-slate-200 rounded-lg">
            <div className="bg-slate-50 p-3 border-b border-slate-200 text-sm font-medium text-slate-700">
              Vista previa de enunciados
            </div>
            <div className="p-4 h-96 overflow-y-auto bg-slate-50 text-sm text-slate-600 space-y-4 shadow-inner">
              {enunciados.map((item, idx) => (
                <div
                  key={`${item.codigo}-${idx}`}
                  className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-emerald-300 transition-colors"
                >
                  <span className="font-bold text-[#2a40b3] block mb-3 border-b border-slate-100 pb-2">
                    {item.codigo}
                  </span>

                  {/*
                    El HTML llega ya saneado desde el servidor (lib/html/sanear):
                    lista blanca de etiquetas, sin atributos `on*` ni etiquetas
                    ejecutables.
                  */}
                  <div
                    className="text-sm text-slate-700 prose prose-sm max-w-none [&_p]:m-0 [&_p]:mb-1"
                    dangerouslySetInnerHTML={{ __html: item.enunciadoHtml }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Reposo icono="📝" texto="Carga un archivo" />
      )}
    </div>
  );
}
