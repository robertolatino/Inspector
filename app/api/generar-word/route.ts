import { NextResponse } from 'next/server';
import { Document, HeadingLevel, Packer, Paragraph, Table } from 'docx';
import { actividadCompletaAParrafos } from '@/lib/html/actividadCompletaADocx';
import { htmlAParrafos } from '@/lib/html/aDocx';
import { PLATAFORMAS } from '@/lib/plataformas';
import { leerSesion } from '@/lib/session';
import { esActividadCompleta, type ModoExtraccion } from '@/lib/types';

/** Fuente del documento entero; Word por defecto usa Times New Roman. */
const FUENTE = 'Calibri';

/**
 * Genera el Word con lo extraído. La conversión a párrafos/tablas vive en
 * `lib/html/aDocx` (modo `solo-enunciado`) y `lib/html/actividadCompletaADocx`
 * (modo `completo`), y está cubierta por tests: es la parte del proyecto que
 * es función pura.
 */
export async function POST(request: Request) {
  const sesion = await leerSesion();
  if (!sesion) {
    return NextResponse.json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' }, { status: 401 });
  }

  const cuerpo = await request.json().catch(() => null);
  const modo: ModoExtraccion = cuerpo?.modo === 'completo' ? 'completo' : 'solo-enunciado';
  const recibidos: unknown = modo === 'completo' ? cuerpo?.actividades : cuerpo?.enunciados;

  if (!Array.isArray(recibidos) || recibidos.length === 0) {
    return NextResponse.json({ error: 'No hay datos para generar el documento.' }, { status: 400 });
  }
  if (modo === 'completo' && !recibidos.every(esActividadCompleta)) {
    return NextResponse.json({ error: 'Los datos recibidos no tienen el formato esperado.' }, { status: 400 });
  }

  try {
    const contenido: (Paragraph | Table)[] = [
      new Paragraph({
        text: `${modo === 'completo' ? 'Actividades' : 'Enunciados'} extraídos — ${PLATAFORMAS[sesion.plataforma].nombre}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
      }),
    ];

    if (modo === 'completo') {
      for (const actividad of recibidos) contenido.push(...actividadCompletaAParrafos(actividad));
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
        contenido.push(new Paragraph({ text: '' }));
      }
    }

    const doc = new Document({
      styles: {
        default: {
          document: { run: { font: FUENTE } },
          heading1: { run: { font: FUENTE } },
          heading2: { run: { font: FUENTE } },
          heading3: { run: { font: FUENTE } },
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
