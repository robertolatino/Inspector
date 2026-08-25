import { NextResponse } from 'next/server';
import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import { htmlAParrafos } from '@/lib/html/aDocx';
import { PLATAFORMAS } from '@/lib/plataformas';
import { leerSesion } from '@/lib/session';

/**
 * Genera el Word con los enunciados extraídos.
 *
 * La conversión HTML → párrafos vive en `lib/html/aDocx` y está cubierta por
 * tests: es la única parte del proyecto que es una función pura.
 */
export async function POST(request: Request) {
  const sesion = await leerSesion();
  if (!sesion) {
    return NextResponse.json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' }, { status: 401 });
  }

  const cuerpo = await request.json().catch(() => null);
  const recibidos: unknown = cuerpo?.enunciados;

  if (!Array.isArray(recibidos) || recibidos.length === 0) {
    return NextResponse.json({ error: 'No hay datos para generar el documento.' }, { status: 400 });
  }

  try {
    const contenido: Paragraph[] = [
      new Paragraph({
        text: `Enunciados extraídos — ${PLATAFORMAS[sesion.plataforma].nombre}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
      }),
    ];

    for (const item of recibidos) {
      const codigo = typeof item?.codigo === 'string' ? item.codigo : '(sin código)';
      const html = typeof item?.enunciadoHtml === 'string' ? item.enunciadoHtml : '';

      contenido.push(
        new Paragraph({
          text: codigo,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 },
        }),
      );

      const parrafos = htmlAParrafos(html);
      contenido.push(
        ...(parrafos.length > 0 ? parrafos : [new Paragraph({ text: '[SIN CONTENIDO]' })]),
      );
      contenido.push(new Paragraph({ text: '' }));
    }

    const doc = new Document({ sections: [{ properties: {}, children: contenido }] });
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
