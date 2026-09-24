import { AlignmentType, HeadingLevel, ImageRun, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { ActividadCompleta, PatronRespuesta } from '../types';
import { htmlAParrafos } from './aDocx';
import { detalleAParrafos } from './detalleADocx';

/**
 * Bloque Word completo de una actividad en modo `completo`: tabla de
 * información (nombre, código, tipo), vista previa visual si se pudo
 * capturar, enunciado y la respuesta según el patrón detectado.
 *
 * Separado de `app/api/generar-word/route.ts` por lo mismo que `aDocx.ts`:
 * aquí no hay lógica de negocio, solo ensamblado de párrafos/tablas de Word a
 * partir de datos ya extraídos y ya interpretados.
 */

const TITULO_DETALLE: Record<PatronRespuesta, string> = {
  opciones: 'Opciones',
  desplegable: 'Opciones',
  tabla: 'Tabla',
  relleno: 'Respuesta',
  orden: 'Orden correcto',
  sin_solucion: 'Sin solución automática',
};

const COLOR_ETIQUETA = 'F2F2F2';
/** Ancho máximo de la vista previa en el documento; más grande no cabe cómodo en una página A4/carta. */
const ANCHO_MAXIMO_CAPTURA = 480;

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
    rows: [
      filaInfo('Nombre de la actividad', actividad.nombre || '(sin nombre)'),
      filaInfo('Código ERP', actividad.codigo),
      filaInfo('Tipo de actividad', actividad.tipoPlantilla || 'Desconocido'),
    ],
  });
}

/** null cuando no hubo captura o no se pudieron leer sus dimensiones. */
function previewImagen(actividad: ActividadCompleta): Paragraph | null {
  const { capturaBase64, capturaAncho, capturaAlto } = actividad;
  if (!capturaBase64 || !capturaAncho || !capturaAlto) return null;

  // Solo se reduce si hace falta: nunca se agranda una captura pequeña.
  const escala = Math.min(1, ANCHO_MAXIMO_CAPTURA / capturaAncho);

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [
      new ImageRun({
        // El byte stream es JPEG (así lo pide Playwright); docx usa 'jpg' como
        // discriminador de tipo, no 'jpeg'.
        type: 'jpg',
        data: Buffer.from(capturaBase64, 'base64'),
        transformation: {
          width: Math.round(capturaAncho * escala),
          height: Math.round(capturaAlto * escala),
        },
      }),
    ],
  });
}

export function actividadCompletaAParrafos(actividad: ActividadCompleta): (Paragraph | Table)[] {
  const bloques: (Paragraph | Table)[] = [
    new Paragraph({
      text: actividad.codigo,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 120 },
    }),
    tablaInformacion(actividad),
  ];

  const imagen = previewImagen(actividad);
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

  const patron = actividad.detalle?.patron ?? 'sin_solucion';
  bloques.push(
    new Paragraph({
      text: TITULO_DETALLE[patron],
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 80 },
    }),
    ...detalleAParrafos(actividad.detalle),
  );

  bloques.push(new Paragraph({ text: '' }));

  return bloques;
}
