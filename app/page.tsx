"use client";

import { useState, useRef, useEffect } from "react";
import * as XLSX from 'xlsx';

export default function Home() {
  // --- ESTADOS DE LA APLICACIÓN ---
  const [isLogged, setIsLogged] = useState(false);
  const [credenciales, setCredenciales] = useState({ usuario: "", password: "", plataforma: "EPD" });
  const [activeView, setActiveView] = useState("recolector");

  // --- ESTADOS DEL RECOLECTOR (PASO 1) ---
  const [codigoPadre, setCodigoPadre] = useState("");
  const [isRecolectando, setIsRecolectando] = useState(false);
  // CAMBIO: Ahora guarda un array de objetos { "GUID/ERP": "...", "Name": "..." }
  const [codigosExtraidos, setCodigosExtraidos] = useState<any[]>([]);
  const [recolectorError, setRecolectorError] = useState("");

  // --- ESTADOS DE LA TERMINAL EN VIVO ---
  const [logs, setLogs] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);

  // --- ESTADOS DEL EXTRACTOR (PASO 2) ---
  const [codigosAExtraer, setCodigosAExtraer] = useState<any[]>([]);
  const [isExtrayendo, setIsExtrayendo] = useState(false);
  const [enunciadosExtraidos, setEnunciadosExtraidos] = useState<any[]>([]);
  const [extractorError, setExtractorError] = useState("");

  const [extractorLogs, setExtractorLogs] = useState<string[]>([]);
  const terminalExtractorRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para la terminal del extractor
  useEffect(() => {
    if (terminalExtractorRef.current) {
      terminalExtractorRef.current.scrollTop = terminalExtractorRef.current.scrollHeight;
    }
  }, [extractorLogs]);

  // Auto-scroll para la terminal cuando llega un nuevo mensaje
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  // --- FUNCIÓN: EJECUTAR RECOLECCIÓN ---
  const handleRecoleccion = async () => {
    if (!codigoPadre) {
      setRecolectorError("Por favor, introduce un código de libro válido.");
      return;
    }

    setIsRecolectando(true);
    setRecolectorError("");
    setCodigosExtraidos([]);
    setLogs([]);

    try {
      const urlBase = credenciales.plataforma === "EPD"
        ? "https://publisher.edelvivesdigitalplus.com"
        : "https://publisher.bimedigital.com";

      const respuesta = await fetch('/api/recolector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url_base: urlBase,
          usuario: credenciales.usuario,
          contrasena: credenciales.password,
          codigo_libro: codigoPadre
        })
      });

      const reader = respuesta.body?.getReader();
      if (!reader) throw new Error("No se pudo conectar con el robot.");

      const decoder = new TextDecoder();
      let isDone = false;

      while (!isDone) {
        const { done, value } = await reader.read();
        if (done) {
          isDone = true;
          break;
        }

        const chunkString = decoder.decode(value, { stream: true });
        const lineas = chunkString.split('\n').filter(line => line.trim() !== '');

        for (const linea of lineas) {
          try {
            const data = JSON.parse(linea);

            if (data.type === 'log') {
              setLogs(prev => [...prev, data.message]);
            } else if (data.type === 'success') {
              setCodigosExtraidos(data.codigos);
            } else if (data.type === 'error') {
              setRecolectorError(data.error);
            }
          } catch (e) {
            console.error("Error leyendo línea del stream:", linea);
          }
        }
      }
    } catch (error) {
      setRecolectorError("Error de conexión con el servidor local.");
      console.error(error);
    } finally {
      setIsRecolectando(false);
    }
  };

  // --- FUNCIÓN: DESCARGAR EXCEL ---
  const descargarExcel = () => {
    try {
      if (!codigosExtraidos || codigosExtraidos.length === 0) return;

      const worksheet = XLSX.utils.json_to_sheet(codigosExtraidos);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Hotspots");

      XLSX.writeFile(workbook, `export_hotspots_${codigoPadre}.xlsx`);
    } catch (e) {
      console.error("Error al descargar el archivo Excel:", e);
    }
  };

  // --- FUNCIONES DEL EXTRACTOR ---
  // 1. Leer el EXCEL
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evento) => {
      try {
        const data = new Uint8Array(evento.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Convertimos la hoja de Excel en un array de objetos JSON
        const json = XLSX.utils.sheet_to_json(worksheet);

        // Filtramos para asegurar que existan las columnas clave,
        // y mapeamos para IGNORAR el resto de columnas (Position, Type, Page, etc.)
        const itemsValidos = (json as any[])
          .filter(item => item["GUID/ERP"] && item["Name"])
          .map(item => ({
            "GUID/ERP": item["GUID/ERP"],
            "Name": item["Name"]
          }));

        setCodigosAExtraer(itemsValidos);
        setExtractorError("");
      } catch (error) {
        setExtractorError("Error al leer el Excel. Asegúrate de que contenga las columnas GUID/ERP y Name.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleExtraccion = async () => {
    if (codigosAExtraer.length === 0) {
      setExtractorError("Por favor, sube un archivo con códigos primero.");
      return;
    }

    setIsExtrayendo(true);
    setExtractorError("");
    setEnunciadosExtraidos([]);
    setExtractorLogs([]);

    try {
      const urlBase = credenciales.plataforma === "EPD"
        ? "https://publisher.edelvivesdigitalplus.com"
        : "https://publisher.bimedigital.com";

      const respuesta = await fetch('/api/extractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url_base: urlBase,
          usuario: credenciales.usuario,
          contrasena: credenciales.password,
          codigos: codigosAExtraer
        })
      });

      const reader = respuesta.body?.getReader();
      if (!reader) throw new Error("No se pudo conectar con el robot extractor.");

      const decoder = new TextDecoder();
      let isDone = false;
      let buffer = ""; //Creamos una "sala de espera" para los datos incompletos

      while (!isDone) {
        const { done, value } = await reader.read();
        if (done) {
          isDone = true;
          break;
        }

        // Añadimos el nuevo paquete al buffer que ya teníamos
        buffer += decoder.decode(value, { stream: true });
        
        // Separamos el buffer por saltos de línea
        const partes = buffer.split('\n');
        
        // El ultimo elemento del array siempre será un paquete incompleto 
        // Lo sacamos del array y lo devolvemos al buffer 
        // para que espere a unirse con el siguiente paquete que llegue de la red.
        buffer = partes.pop() || "";

        for (const linea of partes) {
          if (!linea.trim()) continue;
          
          try {
            const data = JSON.parse(linea);

            if (data.type === 'log') {
              setExtractorLogs(prev => [...prev, data.message]);
            } else if (data.type === 'success') {
              setEnunciadosExtraidos(data.resultados);
            } else if (data.type === 'error') {
              setExtractorError(data.error);
            }
          } catch (e) {
            console.error("Error leyendo línea del stream:", linea);
          }
        }
      }

      // Al terminar el stream por completo, si quedó algo atascado en el buffer, lo procesamos
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.type === 'success') {
            setEnunciadosExtraidos(data.resultados);
          }
        } catch (e) {
          console.error("Error procesando el bloque final:", e);
        }
      }
    } catch (error) {
      setExtractorError("Error de conexión con el servidor local.");
    } finally {
      setIsExtrayendo(false);
    }
  };

  const descargarWord = async () => {
    try {
      setExtractorError("");

      const respuesta = await fetch('/api/generar-word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultados: enunciadosExtraidos })
      });

      if (!respuesta.ok) throw new Error("Error al generar el documento Word.");

      const blob = await respuesta.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Enunciados_Edelvives.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (error) {
      setExtractorError("Hubo un problema al generar el archivo Word.");
    }
  };

  // --- COMPONENTE: PANTALLA DE LOGIN ---
  if (!isLogged) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-10 rounded-lg shadow-md max-w-md w-full border border-slate-200">
          <div className="flex justify-center mb-6">
            <div className="bg-[#2a40b3] text-white p-3 rounded-xl font-bold text-2xl">EDV</div>
          </div>
          <h1 className="text-2xl font-bold text-center text-slate-800 mb-2">Inspector</h1>
          <p className="text-sm text-center text-slate-500 mb-8">Inicia sesión con tus credenciales del backoffice</p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Plataforma</label>
              <select
                className="w-full p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2a40b3]"
                value={credenciales.plataforma}
                onChange={(e) => setCredenciales({ ...credenciales, plataforma: e.target.value })}
              >
                <option value="EPD">Edelvives Digital Plus</option>
                <option value="BYME">ByME Digital</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Usuario</label>
              <input
                type="text"
                placeholder="correo@edelvives.es"
                className="w-full p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2a40b3]"
                value={credenciales.usuario}
                onChange={(e) => setCredenciales({ ...credenciales, usuario: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
              <input
                type="password"
                className="w-full p-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2a40b3]"
                value={credenciales.password}
                onChange={(e) => setCredenciales({ ...credenciales, password: e.target.value })}
              />
            </div>
            <button
              onClick={() => setIsLogged(true)}
              className="w-full bg-[#2a40b3] hover:bg-[#1e2e85] text-white font-medium py-2 px-4 rounded-md transition-colors mt-4"
              disabled={!credenciales.usuario || !credenciales.password}
            >
              Acceder
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ---DASHBOARD ---
  return (
    <div className="flex h-screen bg-slate-50 font-sans">

      {/* MENÚ LATERAL (SIDEBAR) */}
      <aside className="w-16 md:w-64 bg-[#232b62] text-white flex flex-col transition-all duration-300">
        <div className="h-16 flex items-center justify-center border-b border-indigo-800/50">
          <span className="font-bold text-xl tracking-wider hidden md:block">INSPECTOR</span>
          <span className="font-bold text-xl block md:hidden">IN</span>
        </div>

        <nav className="flex-1 py-6 space-y-2 px-3">
          <button
            onClick={() => setActiveView("recolector")}
            className={`w-full flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeView === "recolector" ? "bg-[#2a40b3] text-white" : "text-indigo-200 hover:bg-indigo-800/50"}`}
          >
            <span className="hidden md:block font-medium">Recolección</span>
          </button>

          <button
            onClick={() => setActiveView("extractor")}
            className={`w-full flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeView === "extractor" ? "bg-[#2a40b3] text-white" : "text-indigo-200 hover:bg-indigo-800/50"}`}
          >
            <span className="hidden md:block font-medium">Extracción</span>
          </button>

          <button
            onClick={() => setActiveView("analista")}
            className={`w-full flex items-center space-x-3 p-3 rounded-lg transition-colors ${activeView === "analista" ? "bg-[#2a40b3] text-white" : "text-indigo-200 hover:bg-indigo-800/50"}`}
          >
            <span className="hidden md:block font-medium">Análisis IA (Proximamente)</span>
          </button>
        </nav>

        <div className="p-4 border-t border-indigo-800/50">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-sm font-bold">
              {credenciales.usuario.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="hidden md:block overflow-hidden">
              <p className="text-sm font-medium truncate">{credenciales.usuario || "Usuario"}</p>
              <p className="text-xs text-indigo-300 truncate">{credenciales.plataforma}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ÁREA CENTRAL DE TRABAJO */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* CABECERA */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8">
          <h2 className="text-xl font-semibold text-slate-800">
            {activeView === "recolector" && "Búsqueda y Recolección de Códigos"}
            {activeView === "extractor" && "Extracción de Enunciados"}
            {activeView === "analista" && "Copiloto de Revisión Editorial"}
          </h2>

          {/* SELECTOR DE PLATAFORMA */}
          <div className="flex items-center space-x-3">
            <label className="text-sm font-medium text-slate-700">Plataforma:</label>
            <select
              value={credenciales.plataforma}
              onChange={(e) => setCredenciales({ ...credenciales, plataforma: e.target.value })}
              className="p-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#2a40b3]"
            >
              <option value="EPD">Edelvives Digital Plus</option>
              <option value="BYME">ByME Digital</option>
            </select>
          </div>
        </header>

        {/* CONTENIDO */}
        <div className="flex-1 overflow-auto p-8">

          {/* VISTA 1: RECOLECTOR */}
          {activeView === "recolector" && (
            <div className="w-full bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
              <div className="flex items-end space-x-4 mb-8">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Código Padre del Libro</label>
                  <input
                    type="text"
                    placeholder="Ej: 225253_MAT1"
                    className="w-full p-2 border border-slate-300 rounded-md focus:outline-none focus:border-[#2a40b3]"
                    value={codigoPadre}
                    onChange={(e) => setCodigoPadre(e.target.value)}
                    disabled={isRecolectando}
                  />
                </div>
                <button
                  onClick={handleRecoleccion}
                  disabled={isRecolectando || !codigoPadre}
                  className="bg-[#2a40b3] text-white px-6 py-2 rounded-md font-medium hover:bg-[#1e2e85] transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isRecolectando ? (
                    <>
                      <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                      <span>Recolectando...</span>
                    </>
                  ) : (
                    <span>Buscar contenidos</span>
                  )}
                </button>
              </div>

              {/* Manejo de errores */}
              {recolectorError && (
                <div className="p-4 mb-6 bg-red-50 text-red-700 rounded-lg border border-red-200">
                  ❌ {recolectorError}
                </div>
              )}

              {/* Lógica condicional para los 3 estados del área central */}
              {isRecolectando ? (
                // TERMINAL
                <div className="bg-slate-900 rounded-lg p-6 flex flex-col h-72 shadow-inner border border-slate-800">
                  <div ref={terminalRef} className="flex-1 overflow-y-auto font-mono text-sm text-green-400 space-y-1 pr-2">
                    {logs.map((log, index) => (
                      <div key={index} className="opacity-90">{log}</div>
                    ))}
                    <div className="animate-pulse opacity-70 mt-2">_</div>
                  </div>
                </div>
              ) : codigosExtraidos.length > 0 ? (
                <div className="space-y-6">
                  <div className="border-2 border-dashed border-emerald-300 bg-emerald-50 rounded-lg p-8 flex flex-col items-center justify-center text-center">
                    <div className="w-12 h-12 bg-emerald-500 text-white rounded-md flex items-center justify-center text-2xl mb-3 shadow-sm">✓</div>
                    <h3 className="text-emerald-800 font-bold text-lg">¡Recolección completada!</h3>
                    <p className="text-emerald-600 mb-6">Se han extraído {codigosExtraidos.length} códigos</p>

                    <div className="flex space-x-4">
                      <button
                        onClick={descargarExcel}
                        className="bg-emerald-600 text-white px-6 py-2 rounded-md font-medium hover:bg-emerald-700 transition-colors shadow-sm flex items-center space-x-2"
                      >
                        <span className="text-lg">📊</span>
                        <span>Descargar Excel</span>
                      </button>
                    </div>
                  </div>

                  {/* Preview de los códigos */}
                  <div className="border border-slate-200 rounded-lg">
                    <div className="bg-slate-50 p-3 border-b border-slate-200 text-sm font-medium text-slate-700">
                      Vista previa
                    </div>
                    <div className="p-4 h-48 overflow-y-auto bg-slate-50/50 font-mono text-sm space-y-2">
                      {codigosExtraidos.map((item, idx) => (
                        <div key={idx} className="py-2 border-b border-slate-200 last:border-0 flex flex-col">
                          <span className="font-bold text-[#2a40b3]">{item.Name}</span>
                          <span className="text-xs text-slate-500 truncate">{item["GUID/ERP"]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-200 rounded-lg h-64 flex flex-col items-center justify-center text-slate-400">
                  <span className="text-2xl mb-2">🔍</span>
                  <p>Introduce un código para comenzar la recolección</p>
                </div>
              )}
            </div>
          )}

          {/* VISTA 2: EXTRACTOR (CONECTADO A LA API) */}
          {activeView === "extractor" && (
            <div className="w-full bg-white rounded-lg border border-slate-200 p-6 shadow-sm">

              {/* Botonera Superior */}
              <div className="flex items-center justify-between mb-6">
                <div className="relative">
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={handleFileUpload}
                    disabled={isExtrayendo}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className={`border-2 border-dashed rounded-lg p-4 flex items-center space-x-4 transition-colors ${codigosAExtraer.length > 0 ? 'border-emerald-400 bg-emerald-50' : 'border-[#2a40b3]/30 bg-[#2a40b3]/5 hover:bg-[#2a40b3]/10'}`}>
                    <div>
                      <p className="text-slate-700 font-medium">
                        {codigosAExtraer.length > 0 ? `Archivo cargado: ${codigosAExtraer.length} códigos listos` : 'Seleccionar archivo .xlsx'}
                      </p>
                      <p className="text-sm text-slate-500">Sube el archivo generado en el paso anterior o el extraido desde Tangerine</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleExtraccion}
                  disabled={isExtrayendo || codigosAExtraer.length === 0}
                  className="bg-[#2a40b3] text-white px-6 py-3 rounded-md font-medium hover:bg-[#1e2e85] transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isExtrayendo ? (
                    <>
                      <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                      <span>Extrayendo...</span>
                    </>
                  ) : (
                    <span>Iniciar</span>
                  )}
                </button>
              </div>

              {extractorError && (
                <div className="p-4 mb-6 bg-red-50 text-red-700 rounded-lg border border-red-200">
                  ❌ {extractorError}
                </div>
              )}

              {/* Lógica condicional para los 3 estados del Extractor */}
              {isExtrayendo ? (
                // TERMINAL
                <div className="bg-slate-900 rounded-lg p-6 flex flex-col h-72 shadow-inner border border-slate-800">
                  <div ref={terminalExtractorRef} className="flex-1 overflow-y-auto font-mono text-sm text-green-400 space-y-1 pr-2">
                    {extractorLogs.map((log, index) => (
                      <div key={index} className="opacity-90">{log}</div>
                    ))}
                    <div className="animate-pulse opacity-70 mt-2">_</div>
                  </div>
                </div>
              ) : enunciadosExtraidos.length > 0 ? (
                // PANTALLA DE ÉXITO Y PREVIEW
                <div className="space-y-6">
                  <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-6 flex justify-between items-center">
                    <div>
                      <h3 className="text-emerald-800 font-bold text-lg flex items-center"><span className="mr-2">✓</span> Extracción completada</h3>
                      <p className="text-emerald-600">Se han extraído {enunciadosExtraidos.length} enunciados con éxito.</p>
                    </div>
                    <button
                      onClick={descargarWord}
                      className="bg-emerald-600 text-white px-4 py-2 rounded-md font-medium hover:bg-emerald-700 transition-colors shadow-sm flex items-center space-x-2"
                    >
                      <span>Descargar Word (.docx)</span>
                    </button>
                  </div>

                  <div className="border border-slate-200 rounded-lg">
                    <div className="bg-slate-50 p-3 border-b border-slate-200 text-sm font-medium text-slate-700">
                      Vista previa de enunciados
                    </div>
                    <div className="p-4 h-96 overflow-y-auto bg-slate-50 text-sm text-slate-600 space-y-4 shadow-inner">
                      {enunciadosExtraidos.map((item, idx) => (
                        <div key={idx} className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-emerald-300 transition-colors">
                          <span className="font-bold text-[#2a40b3] block mb-3 border-b border-slate-100 pb-2">
                            {item.codigo}
                          </span>

                          <div
                            className="text-sm text-slate-700 prose prose-sm max-w-none [&_p]:m-0 [&_p]:mb-1"
                            dangerouslySetInnerHTML={{
                              __html: item.enunciadoHtml ? item.enunciadoHtml.replace(/<img[^>]*>/g, '') : ''
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                // PANTALLA DE REPOSO
                <div className="border-2 border-dashed border-slate-200 rounded-lg h-64 flex flex-col items-center justify-center text-slate-400">
                  <span className="text-2xl mb-2">📝</span>
                  <p>Carga un archivo</p>
                </div>
              )}
            </div>
          )}

          {/* VISTA 3: ANALISTA IA */}
          {activeView === "analista" && (
            <div className="w-full bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <div className="flex space-x-4">
                  <select className="p-2 text-sm border border-slate-300 rounded-md focus:outline-none">
                    <option>Criterio: Libro de Matemáticas (6 años)</option>
                    <option>Criterio: Libro de Lengua (10 años)</option>
                  </select>
                </div>
                <button className="bg-[#2a40b3] text-white px-4 py-2 text-sm rounded-md font-medium hover:bg-[#1e2e85]">
                  Ejecutar Revisión IA
                </button>
              </div>

              {/* Tabla interactiva */}
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
                    <tr className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-4 font-medium text-slate-700">U01_ACT05</td>
                      <td className="p-4 text-slate-600">Calculad el resultado de las siguientes operaciones y escribidlos abajo.</td>
                      <td className="p-4 text-emerald-700 font-medium bg-emerald-50/50">Calcula el resultado de las operaciones y escríbelo.</td>
                      <td className="p-4">
                        <span className="inline-block px-2 py-1 bg-amber-100 text-amber-800 text-xs rounded-md mb-2">Voz / Edad</span>
                        <p className="text-xs text-slate-500 mb-2">Para 6 años, el manual indica usar 2ª persona del singular (tú), no plural (vosotros).</p>
                        <div className="flex space-x-2">
                          <button className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded hover:bg-emerald-200">Aceptar</button>
                          <button className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded hover:bg-slate-200">Ignorar</button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}