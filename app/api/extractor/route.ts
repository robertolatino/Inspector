import { chromium } from 'playwright';

export async function POST(request: Request) {
  // Recibimos las credenciales y el array de códigos (ej: ["U01_ACT01", "U01_ACT02"])
  const { url_base, usuario, contrasena, codigos } = await request.json();

  if (!url_base || !usuario || !contrasena || !codigos || codigos.length === 0) {
    return new Response(JSON.stringify({ type: 'error', error: "Faltan datos o la lista de códigos está vacía." }), { status: 400 });
  }

  const encoder = new TextEncoder();

  // Creamos el "Tubo de transmisión en vivo" hacia la terminal del Frontend
  const stream = new ReadableStream({
    async start(controller) {
      
      const sendLog = (msg: string) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'log', message: msg }) + '\n'));
      };
      // Enviaremos un array de objetos: { codigo: "...", enunciado_html: "..." }
      const sendSuccess = (resultados: any[]) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'success', resultados }) + '\n'));
      };
      const sendError = (error: string) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error }) + '\n'));
      };

      try {
        sendLog(`[🤖 Extractor] Iniciando motor para extraer ${codigos.length} enunciados...`);
        
        // Iniciamos el navegador (usamos Chromium por defecto en Vercel/Docker, 
        // aunque el script original usaba Firefox, Chromium es más rápido y estable para esto)
        const browser = await chromium.launch({ headless: false });
        sendLog(`[🔌] Navegador virtual iniciado en segundo plano.`);
        
        const context = await browser.newContext({
          locale: 'es-ES',
          timezoneId: 'Europe/Madrid',
          extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' }
        });
        const page = await context.newPage();

        // --- FUNCIONES AUXILIARES ---
        async function aplicarFiltroGlobal() {
          try {
            sendLog(`[⚙️] Aplicando filtro de 'Question'...`);
            await page.locator('.input-search-filter__button').first().click();
            await page.waitForTimeout(1000);
            await page.locator('[id="Tipo de contenido"]').first().click();
            await page.waitForTimeout(1000);
            await page.locator('label:has-text("Question")').first().click();
            await page.waitForTimeout(500);
            await page.locator('button[aria-label="Aplicar filtros"]').first().click();
            await page.waitForLoadState("networkidle");
            await page.waitForTimeout(2000);
          } catch (e) {
             // Ignoramos el error si ya estaba aplicado
          }
        }

        // --- NAVEGACIÓN Y LOGIN ---
        sendLog(`[🔐] Accediendo a la plataforma...`);
        await page.goto(`${url_base}/auth/login`);
        
        await page.locator('input[type="text"], input[type="email"], input[name="username"]').first().fill(usuario);
        await page.locator('input[type="password"], input[name="password"]').first().fill(contrasena);
        await page.locator('button[type="submit"], button:has-text("Iniciar sesión"), button:has-text("Login")').first().click();
        await page.waitForLoadState("networkidle");
        
        sendLog(`[📂] Navegando a la sección de Contenidos...`);
        await page.locator('div[aria-label="Contenidos"]').first().click();
        await page.waitForTimeout(1000);
        await page.locator('.wrapper-list-menu__item a[href="/contents"]').first().click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1500);
        
        await aplicarFiltroGlobal();

        const resultados = [];
        
        // --- BUCLE DE EXTRACCIÓN ---
        for (let i = 0; i < codigos.length; i++) {
          const codigo = codigos[i];
          sendLog(`[⏳] Procesando [${i + 1}/${codigos.length}]: ${codigo}...`);
          
          try {
            // Buscamos el código exacto
            const buscador = page.locator('input[data-testid="search"]');
            await buscador.fill(""); 
            await buscador.fill(codigo);
            await buscador.press("Enter");
            
            const enlaceResultado = page.locator(`a:text-is("${codigo}")`).first();
            
            try {
              await enlaceResultado.waitFor({ state: "visible", timeout: 8000 });
            } catch (error) {
               sendLog(`[⚠️] El código ${codigo} no aparece en los resultados. Saltando...`);
               resultados.push({ codigo, enunciadoHtml: "[NO ENCONTRADO]" });
               continue;
            }
            
            // Verificamos si la fila contiene "Question"
            const fila = page.locator(`tr:has(a:text-is("${codigo}"))`).first();
            const esQuestion = await fila.locator('td:text-is("Question")').isVisible();
            
            if (!esQuestion) {
               sendLog(`[⚠️] El código ${codigo} no es de tipo 'Question'. Saltando...`);
               resultados.push({ codigo, enunciadoHtml: "[NO ES QUESTION]" });
               continue;
            }
            
            // Entramos a la actividad
            await enlaceResultado.click();
            await page.waitForLoadState("networkidle");
            await page.waitForTimeout(1000);
            
            // Buscamos la pestaña "Editor"
            const btnEditor = page.locator('button:has-text("Editor")').first();
            
            try {
                await btnEditor.waitFor({ state: "visible", timeout: 8000 });
                await btnEditor.click();
                await page.waitForLoadState("networkidle");
                await page.waitForTimeout(2000); 
                
                // Buscamos el bloque del enunciado y su textarea oculta
                const bloqueEnunciado = page.locator('div[data-id="stimulus"]');
                
                try {
                    await bloqueEnunciado.waitFor({ state: "visible", timeout: 8000 });
                    const textareaOculto = bloqueEnunciado.locator('textarea').first();
                    await textareaOculto.waitFor({ state: "attached", timeout: 3000 });
                    
                    // Extraemos el HTML crudo evaluando el DOM
                    const descripcionHtml = await textareaOculto.evaluate((el: HTMLTextAreaElement) => el.value);
                    resultados.push({ codigo, enunciadoHtml: descripcionHtml });
                    sendLog(`[✅] Enunciado extraído correctamente.`);
                    
                } catch (e) {
                    sendLog(`[⚠️] No se encontró el texto en el editor de ${codigo}.`);
                    resultados.push({ codigo, enunciadoHtml: "[SIN ENUNCIADO EN EL EDITOR]" });
                }

            } catch (e) {
                sendLog(`[⚠️] No se pudo acceder a la pestaña Editor en ${codigo}.`);
                resultados.push({ codigo, enunciadoHtml: "[SIN PESTAÑA EDITOR]" });
            }

            // Volvemos a la lista para buscar el siguiente
            const btnVolver = page.locator('button[aria-label="Volver"]').first();
            await btnVolver.waitFor({ state: "visible", timeout: 4000 });
            await btnVolver.click();
            await page.waitForLoadState("networkidle");
            await page.waitForTimeout(1500);
            
          } catch (e) {
            sendLog(`[❌] Error inesperado procesando ${codigo}. Saltando al siguiente...`);
            resultados.push({ codigo, enunciadoHtml: "[ERROR DURANTE EXTRACCIÓN]" });
          }
        }

        await browser.close();
        
        sendLog(`[🎉] Extracción completada. ${resultados.length} procesados.`);
        sendSuccess(resultados);
        controller.close();

      } catch (error) {
        sendLog(`[❌] ERROR CRÍTICO en el Extractor.`);
        sendError(String(error));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}