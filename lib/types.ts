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

/**
 * `solo-enunciado` es el comportamiento de siempre. `completo` añade el tipo
 * de plantilla, una captura visual y el texto del ejercicio (ver
 * `ActividadCompleta`). `captura` es la versión ligera: solo la captura
 * visual, sin leer enunciado ni tipo (ver `ActividadCaptura`).
 */
export type ModoExtraccion = 'solo-enunciado' | 'completo' | 'captura';

/** Captura de la vista previa en JPEG (base64, sin el prefijo data:) más sus
 * dimensiones reales, para no deformarla al incrustarla en el Word. Todo
 * `null` cuando no se pudo capturar. */
export interface Captura {
  capturaBase64: string | null;
  capturaAncho: number | null;
  capturaAlto: number | null;
}

export interface ActividadCompleta extends Captura {
  codigo: string;
  /** Nombre legible del tipo de plantilla (p. ej. "Unir"). Ver `lib/publisher/tipoPlantilla.ts`. */
  tipoPlantilla: string;
  enunciadoHtml: string;
  /**
   * HTML de `[data-testid="questionBase"]`, ya saneado, tal cual aparece en el
   * backoffice — sin interpretar por tipo de plantilla. Se prefiere el de
   * "Soluciones" (no repite el enunciado y no viene desordenado); si la
   * actividad no tiene panel de soluciones se usa el de la vista previa. null
   * si no se pudo leer ninguno de los dos. En el Word se muestra sin rótulo
   * propio, pegado al enunciado.
   */
  ejercicioHtml: string | null;
}

/** Análoga a `esActividadRef`, para lo que devuelve el modo `completo`. */
export function esActividadCompleta(valor: unknown): valor is ActividadCompleta {
  if (typeof valor !== 'object' || valor === null) return false;
  const fila = valor as Record<string, unknown>;
  return typeof fila.codigo === 'string' && typeof fila.enunciadoHtml === 'string';
}

/** Lo que devuelve el modo `captura`: nada más que el código y la imagen. */
export interface ActividadCaptura extends Captura {
  codigo: string;
}

/** Análoga a `esActividadRef`, para lo que devuelve el modo `captura`. */
export function esActividadCaptura(valor: unknown): valor is ActividadCaptura {
  if (typeof valor !== 'object' || valor === null) return false;
  const fila = valor as Record<string, unknown>;
  return typeof fila.codigo === 'string';
}

/** Protocolo del stream NDJSON: una línea de JSON por mensaje. */
export type MensajeStream<T> =
  | { type: 'log'; message: string }
  | { type: 'success'; data: T }
  | { type: 'error'; error: string };
