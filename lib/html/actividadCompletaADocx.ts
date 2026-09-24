import { BorderStyle, HeadingLevel, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { ActividadCompleta } from '../types';
import { htmlAParrafos, parrafoCaptura, separadorActividad } from './aDocx';

/**
 * Bloque Word completo de una actividad en modo `completo`: tabla de
 * información (código, tipo), vista previa visual si se pudo capturar, y
 * enunciado + ejercicio (sin rótulo propio para el ejercicio: se muestra
 * pegado al enunciado, tal cual aparece en el backoffice, sin interpretar
 * nada por tipo de plantilla).
 *
 * Separado de `app/api/generar-word/route.ts` por lo mismo que `aDocx.ts`:
 * aquí no hay lógica de negocio, solo ensamblado de párrafos/tablas de Word a
 * partir de datos ya extraídos.
 */

const COLOR_ETIQUETA = 'F2F2F2';
const COLOR_BORDE_TABLA = 'BFBFBF';

const BORDE_TABLA = { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDE_TABLA };
/** Un poco de aire dentro de cada celda: por defecto `docx` las deja muy apretadas. */
const MARGENES_CELDA = { top: 80, bottom: 80, left: 120, right: 120 };

function filaInfo(etiqueta: string, valor: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        shading: { fill: COLOR_ETIQUETA },
        children: [new Paragraph({ children: [new TextRun({ text: etiqueta, bold: true })] })],
      }),
      new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ text: valor })],
      }),
    ],
  });
}

function tablaInformacion(actividad: ActividadCompleta): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: MARGENES_CELDA,
    borders: {
      top: BORDE_TABLA,
      bottom: BORDE_TABLA,
      left: BORDE_TABLA,
      right: BORDE_TABLA,
      insideHorizontal: BORDE_TABLA,
      insideVertical: BORDE_TABLA,
    },
    rows: [
      filaInfo('Código ERP', actividad.codigo),
      filaInfo('Tipo de actividad', actividad.tipoPlantilla || 'Desconocido'),
    ],
  });
}

export function actividadCompletaAParrafos(actividad: ActividadCompleta): (Paragraph | Table)[] {
  const bloques: (Paragraph | Table)[] = [tablaInformacion(actividad)];

  const imagen = parrafoCaptura(actividad);
  if (imagen) {
    bloques.push(
      new Paragraph({
        text: 'Vista previa',
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 80 },
      }),
      imagen,
    );
  }

  bloques.push(
    new Paragraph({ text: 'Enunciado', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 } }),
  );
  const parrafosEnunciado = htmlAParrafos(actividad.enunciadoHtml);
  bloques.push(
    ...(parrafosEnunciado.length > 0 ? parrafosEnunciado : [new Paragraph({ text: '[SIN CONTENIDO]' })]),
  );

  // El ejercicio va sin rótulo propio, pegado al enunciado: es contenido, no
  // una sección aparte.
  if (actividad.ejercicioHtml) {
    bloques.push(...htmlAParrafos(actividad.ejercicioHtml));
  }

  bloques.push(separadorActividad());

  return bloques;
}
