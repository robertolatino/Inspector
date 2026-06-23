import { NextResponse } from 'next/server';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import * as cheerio from 'cheerio';

export async function POST(request: Request) {
  try {
    const { resultados } = await request.json();

    if (!resultados || resultados.length === 0) {
      return NextResponse.json({ error: "No hay datos para generar el documento." }, { status: 400 });
    }

    // 1. Array donde guardaremos todos los párrafos del documento
    const parrafosDoc: Paragraph[] = [];

    // Título Principal del Documento
    parrafosDoc.push(
      new Paragraph({ 
        text: "Enunciados Extraídos - Edelvives Digital Plus (EPD)", 
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 } 
      })
    );

    // 2. Iteramos sobre cada resultado extraído
    for (const item of resultados) {
      const codigo = item.codigo;
      const htmlText = item.enunciadoHtml;

      // Añadimos el Código de la actividad (Estilo Título 2)
      parrafosDoc.push(
        new Paragraph({ 
          text: codigo, 
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 }
        })
      );

      // Preparamos el array de "fragmentos de texto" para el enunciado
      const fragmentosTexto: TextRun[] = [
        new TextRun({ text: "Enunciado: ", bold: true })
      ];

      // Si falló la extracción, lo indicamos directamente
      if (!htmlText || htmlText.startsWith("[")) {
        fragmentosTexto.push(new TextRun({ text: htmlText || "[ERROR: Sin contenido]" }));
      } else {
        // 3. Traducimos el HTML a formato Word (Igual que hacía BeautifulSoup)
        const $ = cheerio.load(htmlText);
        
        $('*').contents().each((i, el) => {
          if (el.type === 'text') {
            const texto = $(el).text().replace(/\n/g, ' '); // Limpiamos saltos de línea raros
            if (texto.trim() === '') return;
            
            let isBold = false;
            let isItalic = false;
            let isUnderline = false;
            
            // Subimos por el árbol HTML para ver si está dentro de una etiqueta <b>, <i>, <u>
            let parent = el.parent;
            while (parent && parent.type === 'tag') {
              if (parent.name === 'b' || parent.name === 'strong') isBold = true;
              if (parent.name === 'i' || parent.name === 'em') isItalic = true;
              if (parent.name === 'u') isUnderline = true;
              parent = parent.parent;
            }
            
            fragmentosTexto.push(new TextRun({ 
              text: texto, 
              bold: isBold, 
              italics: isItalic, 
              underline: isUnderline ? {} : undefined 
            }));
          }
        });
      }

      // Añadimos el párrafo ensamblado al documento
      parrafosDoc.push(new Paragraph({ children: fragmentosTexto }));
      
      // Salto de línea de separación
      parrafosDoc.push(new Paragraph({ text: "" }));
    }

    // 4. Construimos el documento Word final
    const doc = new Document({
      sections: [{ properties: {}, children: parrafosDoc }]
    });

    // 5. Lo empaquetamos en un Buffer de Node.js
    const nodeBuffer = await Packer.toBuffer(doc);
    
    // SOLUCIÓN: Lo convertimos a un Uint8Array (Estándar Web) para que TypeScript sea feliz
    const webBuffer = new Uint8Array(nodeBuffer);

    // Devolvemos el archivo con las cabeceras correctas para que el navegador lo descargue
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