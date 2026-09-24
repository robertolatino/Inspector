import { AlignmentType, BorderStyle, ImageRun, Paragraph, TextRun } from 'docx';
import type { Captura } from '../types';
import { parsearEnunciado, type Bloque } from './parseEnunciado';

/**
 * Mapeo de los bloques parseados a párrafos de Word.
 *
 * Aquí no hay lógica: toda la interpretación del HTML está en
 * `parseEnunciado`, que es donde están los tests.
 */

const COLOR_SEPARADOR = 'CCCCCC';

/** Línea horizontal entre actividades: más clara que un simple párrafo en blanco. */
export function separadorActividad(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR_SEPARADOR } },
    spacing: { before: 200, after: 300 },
  });
}

/** Ancho máximo de una captura en el documento; más grande no cabe cómodo en una página A4/carta. */
const ANCHO_MAXIMO_CAPTURA = 480;

/** Imagen centrada a partir de una `Captura`; null cuando no hubo captura o no se pudieron leer sus dimensiones. */
export function parrafoCaptura({ capturaBase64, capturaAncho, capturaAlto }: Captura): Paragraph | null {
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

function aParrafo(bloque: Bloque): Paragraph {
  const children = bloque.fragmentos.map((fragmento) =>
    fragmento.salto
      ? new TextRun({ break: 1 })
      : new TextRun({
          text: fragmento.texto,
          bold: fragmento.negrita,
          italics: fragmento.cursiva,
          underline: fragmento.subrayado ? {} : undefined,
        }),
  );

  return new Paragraph({
    children,
    // Nota: las listas numeradas también salen con viñeta. Numerarlas de verdad
    // exige declarar una definición de numeración en el Document, y en los
    // enunciados apenas aparecen.
    ...(bloque.vineta !== null ? { bullet: { level: bloque.vineta } } : {}),
  });
}

export function htmlAParrafos(html: string): Paragraph[] {
  return parsearEnunciado(html).map(aParrafo);
}
