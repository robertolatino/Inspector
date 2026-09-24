import { HeadingLevel, Paragraph, type Table } from 'docx';
import type { ActividadCaptura } from '../types';
import { parrafoCaptura, separadorActividad } from './aDocx';

/**
 * Bloque Word de una actividad en modo `captura`: solo el código como
 * encabezado y la imagen, sin tabla de información ni enunciado.
 */
export function actividadCapturaAParrafos(actividad: ActividadCaptura): (Paragraph | Table)[] {
  const bloques: (Paragraph | Table)[] = [
    new Paragraph({ text: actividad.codigo, heading: HeadingLevel.HEADING_2, spacing: { after: 120 } }),
  ];

  const imagen = parrafoCaptura(actividad);
  bloques.push(imagen ?? new Paragraph({ text: '[SIN CAPTURA]' }));

  bloques.push(separadorActividad());

  return bloques;
}
