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
 * `solo-enunciado` es el comportamiento de siempre. `completo` añade opciones y,
 * cuando el tipo de plantilla lo permite, cuál es la correcta — ver
 * `lib/publisher/analizarSolucion.ts` para cómo se detecta.
 */
export type ModoExtraccion = 'solo-enunciado' | 'completo';

/**
 * Cómo se ha reconocido la respuesta correcta de una actividad en modo
 * `completo`. No se deriva del tipo de plantilla (el backoffice no lo expone de
 * forma fiable) sino de la forma del DOM del editor: ver
 * `lib/publisher/analizarSolucion.ts`.
 */
export type PatronRespuesta =
  | 'opciones' // .lemo-selected con texto: respuesta única, múltiple, V/F...
  | 'tabla' // matriz/posicional: la celda marcada no lleva texto
  | 'relleno' // hueco recuperado por diferencia entre pregunta y solución
  | 'desplegable' // opción elegida dentro de un desplegable
  | 'orden' // el orden de la solución es la respuesta
  | 'sin_solucion'; // sin señal automática: solo se guarda lo visible

export interface OpcionRespuesta {
  /** HTML ya saneado con `sanearHtmlEnunciado`. */
  html: string;
  correcta: boolean;
}

export interface FilaTabla {
  /** HTML ya saneado de cada celda, en orden de columna. */
  celdas: string[];
  columnaCorrecta: number | null;
}

export interface DetalleCompleto {
  patron: PatronRespuesta;
  /** 'opciones' | 'desplegable' */
  opciones?: OpcionRespuesta[];
  /** 'tabla' */
  tabla?: { cabecera: string[]; filas: FilaTabla[] };
  /** 'relleno' */
  relleno?: string[];
  /** 'orden' */
  orden?: string[];
  /** 'sin_solucion': HTML visible tal cual, ya saneado. */
  contenidoSinSolucion?: string;
}

export interface ActividadCompleta {
  codigo: string;
  /** "Nombre interno" de la actividad (el título legible, p. ej. "Relaciona las palabras"). */
  nombre: string;
  /** Nombre legible del tipo de plantilla (p. ej. "Unir"). Ver `lib/publisher/tipoPlantilla.ts`. */
  tipoPlantilla: string;
  enunciadoHtml: string;
  /** null solo en error de navegación o editor sin enunciado, igual que hoy. */
  detalle: DetalleCompleto | null;
  /** Captura de la vista previa en JPEG (base64, sin el prefijo data:). null si no se pudo capturar. */
  capturaBase64: string | null;
  /** Dimensiones reales de la captura en píxeles, para no deformarla al incrustarla en el Word. */
  capturaAncho: number | null;
  capturaAlto: number | null;
}

/** Análoga a `esActividadRef`, para lo que devuelve el modo `completo`. */
export function esActividadCompleta(valor: unknown): valor is ActividadCompleta {
  if (typeof valor !== 'object' || valor === null) return false;
  const fila = valor as Record<string, unknown>;
  return typeof fila.codigo === 'string' && typeof fila.enunciadoHtml === 'string';
}

/** Protocolo del stream NDJSON: una línea de JSON por mensaje. */
export type MensajeStream<T> =
  | { type: 'log'; message: string }
  | { type: 'success'; data: T }
  | { type: 'error'; error: string };
