import { Paragraph, TextRun } from 'docx';
import { parsearEnunciado, type Bloque } from './parseEnunciado';

/**
 * Mapeo de los bloques parseados a párrafos de Word.
 *
 * Aquí no hay lógica: toda la interpretación del HTML está en
 * `parseEnunciado`, que es donde están los tests.
 */

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
