import { Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import type { DetalleCompleto, FilaTabla } from '../types';
import { htmlAParrafos } from './aDocx';
import { parsearEnunciado, type Bloque } from './parseEnunciado';

/**
 * Mapeo de `DetalleCompleto` (la respuesta de una actividad ya interpretada
 * por `lib/publisher/analizarSolucion`) a párrafos/tablas de Word.
 *
 * Convención de marcado de "correcta": negrita + prefijo "✓ " en listas de
 * opciones, sombreado de celda en tablas — más legible que la negrita dentro
 * de una celda pequeña.
 */

const COLOR_CORRECTA = 'D9E8FF';
const SIN_CONTENIDO = [new Paragraph({ text: '[SIN CONTENIDO]' })];

function bloqueAParrafo(bloque: Bloque, forzarNegrita: boolean, prefijo?: string): Paragraph {
  const children: TextRun[] = [];
  if (prefijo) children.push(new TextRun({ text: prefijo, bold: true }));

  for (const fragmento of bloque.fragmentos) {
    children.push(
      fragmento.salto
        ? new TextRun({ break: 1 })
        : new TextRun({
            text: fragmento.texto,
            bold: forzarNegrita || fragmento.negrita,
            italics: fragmento.cursiva,
            underline: fragmento.subrayado ? {} : undefined,
          }),
    );
  }

  return new Paragraph({ children, bullet: { level: 0 } });
}

/** Una opción de respuesta como párrafo(s) con viñeta; la correcta en negrita + "✓ ". */
function parrafosOpcion(html: string, correcta: boolean): Paragraph[] {
  const bloques = parsearEnunciado(html);
  if (bloques.length === 0) {
    return [
      new Paragraph({
        children: [new TextRun({ text: correcta ? '✓' : '', bold: correcta })],
        bullet: { level: 0 },
      }),
    ];
  }

  return bloques.map((bloque, i) => bloqueAParrafo(bloque, correcta, correcta && i === 0 ? '✓ ' : undefined));
}

function celdaTabla(html: string, sombreada: boolean): TableCell {
  const parrafos = htmlAParrafos(html);
  return new TableCell({
    children: parrafos.length > 0 ? parrafos : [new Paragraph({ text: '' })],
    ...(sombreada ? { shading: { fill: COLOR_CORRECTA } } : {}),
  });
}

function filaTablaCabecera(cabecera: string[]): TableRow {
  return new TableRow({
    children: cabecera.map(
      (texto) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: texto, bold: true })] })] }),
    ),
  });
}

function filaTablaDatos(fila: FilaTabla): TableRow {
  return new TableRow({
    children: fila.celdas.map((html, i) => celdaTabla(html, i === fila.columnaCorrecta)),
  });
}

function tablaCompleta(tabla: { cabecera: string[]; filas: FilaTabla[] }): Table {
  return new Table({
    rows: [filaTablaCabecera(tabla.cabecera), ...tabla.filas.map(filaTablaDatos)],
  });
}

export function detalleAParrafos(detalle: DetalleCompleto | null): (Paragraph | Table)[] {
  if (!detalle) return SIN_CONTENIDO;

  switch (detalle.patron) {
    case 'opciones':
    case 'desplegable': {
      const opciones = detalle.opciones ?? [];
      return opciones.length > 0 ? opciones.flatMap((o) => parrafosOpcion(o.html, o.correcta)) : SIN_CONTENIDO;
    }

    case 'tabla': {
      const tabla = detalle.tabla;
      return tabla && tabla.filas.length > 0 ? [tablaCompleta(tabla)] : SIN_CONTENIDO;
    }

    case 'relleno': {
      const relleno = detalle.relleno ?? [];
      return relleno.length > 0
        ? relleno.map((valor) => new Paragraph({ text: `Respuesta: ${valor}` }))
        : SIN_CONTENIDO;
    }

    case 'orden': {
      const orden = detalle.orden ?? [];
      return orden.length > 0
        ? orden.map((texto, i) => new Paragraph({ text: `${i + 1}. ${texto}` }))
        : SIN_CONTENIDO;
    }

    case 'sin_solucion': {
      const parrafos = htmlAParrafos(detalle.contenidoSinSolucion ?? '');
      return [
        ...(parrafos.length > 0 ? parrafos : SIN_CONTENIDO),
        new Paragraph({
          children: [new TextRun({ text: 'Sin solución automática detectada.', italics: true })],
        }),
      ];
    }
  }
}
