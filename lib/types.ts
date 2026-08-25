/**
 * Contratos de datos compartidos entre el servidor y el cliente.
 *
 * Antes cada ruta y cada `useState` declaraba `any[]`, así que un cambio en la
 * forma de los datos no lo detectaba nadie hasta que fallaba en pantalla.
 */

export type PlataformaId = 'EPD' | 'BYME';

/**
 * Una actividad tal y como viaja en el Excel: las claves son literalmente las
 * cabeceras de las columnas, tanto en el archivo que genera el recolector como
 * en el que se exporta desde Tangerine.
 */
export interface ActividadRef {
  'GUID/ERP': string;
  Name: string;
}

export interface EnunciadoExtraido {
  codigo: string;
  enunciadoHtml: string;
}

/**
 * Valida una fila de actividad. Lo usan tanto la lectura del Excel en el cliente
 * como la ruta del extractor: el servidor no se fía de lo que le llega.
 */
export function esActividadRef(valor: unknown): valor is ActividadRef {
  if (typeof valor !== 'object' || valor === null) return false;
  const fila = valor as Record<string, unknown>;
  return (
    typeof fila['GUID/ERP'] === 'string' &&
    fila['GUID/ERP'].trim() !== '' &&
    typeof fila.Name === 'string' &&
    fila.Name.trim() !== ''
  );
}

/** Protocolo del stream NDJSON: una línea de JSON por mensaje. */
export type MensajeStream<T> =
  | { type: 'log'; message: string }
  | { type: 'success'; data: T }
  | { type: 'error'; error: string };
