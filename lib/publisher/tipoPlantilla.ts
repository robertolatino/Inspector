/**
 * Traduce la segunda clase del nodo `.lemo-question` (ver
 * `SELECTORES.editor.tipoPregunta`) a un nombre legible del tipo de plantilla.
 *
 * El backoffice no expone el nombre del tipo en ningún campo de texto —los 23
 * tipos del filtro "Plantilla" no se corresponden con nada leíble en el DOM del
 * editor—, pero cada pregunta sí lleva esta clase interna. El mapa de abajo es
 * el resultado de comprobar en vivo una docena de tipos reales; no cubre los
 * 23. Un tipo sin mapear no rompe nada: se humaniza la clase tal cual (ver
 * `humanizar`) y se registra (parámetro `avisar`) para poder ampliar el mapa
 * con el tiempo en vez de adivinar de antemano.
 */
const NOMBRES_TIPO: Record<string, string> = {
  'lemo-multiple-choice': 'Selección de opción',
  'lemo-choice-matrix': 'Verdadero/Falso o tabla de selección',
  'lemo-classify-order-list': 'Ordenar',
  'lemo-classify-linking-lines': 'Unir',
  'lemo-classify-classification': 'Clasificar',
  'lemo-cloze-text': 'Completar huecos con texto',
  'lemo-label-image-dropdown': 'Completar con desplegable',
  'lemo-label-image-drag': 'Arrastrar y soltar',
  'lemo-label-image-text': 'Completar imagen con texto',
  'lemo-math-cloze-math': 'Fórmulas matemáticas',
  'lemo-essay-short-text': 'Respuesta breve (evaluación manual)',
  'lemo-other-upload-file': 'Respuesta con archivo (evaluación manual)',
};

/** "lemo-classify-linking-lines" → "Classify linking lines". Solo como último recurso. */
function humanizar(clase: string): string {
  const texto = clase.replace(/^lemo-/, '').split('-').join(' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * `claseCruda` es el `className` completo del nodo `.lemo-question` (incluye
 * la propia clase `lemo-question`). `avisar` se llama cuando el tipo no está
 * en el mapa, para poder auditarlo desde el log de la extracción.
 */
export function nombreTipoPlantilla(claseCruda: string | null, avisar?: (clase: string) => void): string {
  if (!claseCruda) return 'Desconocido';

  const clave = claseCruda
    .split(/\s+/)
    .find((c) => c && c !== 'lemo-question');
  if (!clave) return 'Desconocido';

  const nombre = NOMBRES_TIPO[clave];
  if (nombre) return nombre;

  avisar?.(clave);
  return humanizar(clave);
}
