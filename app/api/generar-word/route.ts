import { NextResponse } from 'next/server';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import * as cheerio from 'cheerio';

export async function POST(request: Request) {
  try {
    const { resultados } = await request.json();

    if (!resultados || resultados.length === 0) {
      return NextResponse.json({ error: "No hay datos para generar el documento." }, { status: 400 });
    }

    const parrafosDoc: Paragraph[] = [];

    // Título Principal
    parrafosDoc.push(
      new Paragraph({ 
        text: "Enunciados Extraídos - Edelvives Digital Plus (EPD)", 
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 } 
      })
    );

    for (const item of resultados) {
      const codigo = item.codigo;
      const htmlText = item.enunciadoHtml;

      parrafosDoc.push(
        new Paragraph({ 
          text: codigo, 
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 }
        })
      );

      const fragmentosTexto: TextRun[] = [];

      if (!htmlText || htmlText.startsWith("[")) {
        fragmentosTexto.push(new TextRun({ text: htmlText || "[ERROR: Sin contenido]" }));
      } else {
        const $ = cheerio.load(htmlText);
        
        // Función recursiva que lee de izquierda a derecha manteniendo el orden perfecto
        const procesarNodo = (nodo: any, isBold: boolean, isItalic: boolean, isUnderline: boolean) => {
          if (nodo.type === 'text') {
            // Limpiamos los saltos de línea invisibles del código fuente
            const texto = nodo.data.replace(/\n/g, ''); 
            if (texto) {
              fragmentosTexto.push(new TextRun({ 
                text: texto, 
                bold: isBold, 
                italics: isItalic, 
                underline: isUnderline ? {} : undefined 
              }));
            }
          } else if (nodo.type === 'tag') {
            const b = isBold || nodo.name === 'b' || nodo.name === 'strong';
            const i = isItalic || nodo.name === 'i' || nodo.name === 'em';
            const u = isUnderline || nodo.name === 'u';
            
            // Procesamos los hijos en orden
            $(nodo).contents().each((_, hijo) => {
              procesarNodo(hijo, b, i, u);
            });
            
            // Añadimos un espacio al terminar un párrafo para que las palabras no se peguen
            if (nodo.name === 'p') {
               fragmentosTexto.push(new TextRun({ text: " " }));
            }
          }
        };

        // Iniciamos la lectura desde la raíz
        $('body').contents().each((_, hijo) => {
          procesarNodo(hijo, false, false, false);
        });
      }

      parrafosDoc.push(new Paragraph({ children: fragmentosTexto }));
      parrafosDoc.push(new Paragraph({ text: "" })); // Espacio entre actividades
    }

    const doc = new Document({
      sections: [{ properties: {}, children: parrafosDoc }]
    });

    const nodeBuffer = await Packer.toBuffer(doc);
    const webBuffer = new Uint8Array(nodeBuffer);

    return new Response(webBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="Enunciados_Extraidos.docx"`
      }
    });

  } catch (error) {
    console.error("Error generando Word:", error);
    return NextResponse.json({ error: "Fallo al generar el documento." }, { status: 500 });
  }
}