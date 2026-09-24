import { NextResponse } from 'next/server';
import { Document, HeadingLevel, Packer, Paragraph, Table } from 'docx';
import { actividadCompletaAParrafos } from '@/lib/html/actividadCompletaADocx';
import { htmlAParrafos, separadorActividad } from '@/lib/html/aDocx';
import { actividadCapturaAParrafos } from '@/lib/html/capturaADocx';
import { PLATAFORMAS } from '@/lib/plataformas';
import { leerSesion } from '@/lib/session';
import { esActividadCaptura, esActividadCompleta, type ModoExtraccion } from '@/lib/types';

/** Título del documento según el modo. */
const TITULO_MODO: Record<ModoExtraccion, string> = {
  'solo-enunciado': 'Enunciados',
  completo: 'Actividades',
  captura: 'Capturas',
};

/** Fuente del documento entero; Word por defecto usa Times New Roman. */
const FUENTE = 'Calibri';
/** Tamaños en semipuntos (formato OOXML): 24 = 12pt, el tamaño base pedido. */
const TAMANO_BASE = 24;
const TAMANO_H1 = 36;
const TAMANO_H2 = 28;
/** Mismo azul que usa la propia interfaz de Inspector (botones, marca). */
const COLOR_MARCA = '2A40B3';
const COLOR_H3 = '444444';

/**
 * Genera el Word con lo extraído. La conversión a párrafos/tablas vive en
 * `lib/html/aDocx` (modo `solo-enunciado`), `lib/html/actividadCompletaADocx`
 * (modo `completo`) y `lib/html/capturaADocx` (modo `captura`), y está
 * cubierta por tests: es la parte del proyecto que es función pura.
 */
export async function POST(request: Request) {
  const sesion = await leerSesion();
  if (!sesion) {
    return NextResponse.json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' }, { status: 401 });
  }

  const cuerpo = await request.json().catch(() => null);
  const modo: ModoExtraccion =
    cuerpo?.modo === 'completo' || cuerpo?.modo === 'captura' ? cuerpo.modo : 'solo-enunciado';
  const recibidos: unknown = modo === 'solo-enunciado' ? cuerpo?.enunciados : cuerpo?.actividades;

  if (!Array.isArray(recibidos) || recibidos.length === 0) {
    return NextResponse.json({ error: 'No hay datos para generar el documento.' }, { status: 400 });
  }
  if (modo === 'completo' && !recibidos.every(esActividadCompleta)) {
    return NextResponse.json({ error: 'Los datos recibidos no tienen el formato esperado.' }, { status: 400 });
  }
  if (modo === 'captura' && !recibidos.every(esActividadCaptura)) {
    return NextResponse.json({ error: 'Los datos recibidos no tienen el formato esperado.' }, { status: 400 });
  }

  try {
    const contenido: (Paragraph | Table)[] = [
      new Paragraph({
        text: `${TITULO_MODO[modo]} extraídos — ${PLATAFORMAS[sesion.plataforma].nombre}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
      }),
    ];

    if (modo === 'completo') {
      for (const actividad of recibidos) contenido.push(...actividadCompletaAParrafos(actividad));
    } else if (modo === 'captura') {
      for (const actividad of recibidos) contenido.push(...actividadCapturaAParrafos(actividad));
    } else {
      for (const item of recibidos) {
        const codigo = typeof item?.codigo === 'string' ? item.codigo : '(sin código)';
        const html = typeof item?.enunciadoHtml === 'string' ? item.enunciadoHtml : '';

        contenido.push(
          new Paragraph({ text: codigo, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 } }),
        );
        const parrafos = htmlAParrafos(html);
        contenido.push(
          ...(parrafos.length > 0 ? parrafos : [new Paragraph({ text: '[SIN CONTENIDO]' })]),
        );
        contenido.push(separadorActividad());
      }
    }

    const doc = new Document({
      styles: {
        default: {
          document: { run: { font: FUENTE, size: TAMANO_BASE } },
          heading1: { run: { font: FUENTE, size: TAMANO_H1, bold: true, color: COLOR_MARCA } },
          heading2: { run: { font: FUENTE, size: TAMANO_H2, bold: true, color: COLOR_MARCA } },
          heading3: { run: { font: FUENTE, size: TAMANO_BASE, bold: true, color: COLOR_H3 } },
        },
      },
      sections: [{ properties: {}, children: contenido }],
    });
    const buffer = await Packer.toBuffer(doc);

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="Enunciados_Extraidos.docx"',
      },
    });
  } catch (error) {
    console.error('Error generando Word:', error);
    return NextResponse.json({ error: 'Fallo al generar el documento.' }, { status: 500 });
  }
}
