import { chromium, type Browser } from 'playwright';

// El scrape vive dentro de la petición: sin esto la plataforma la corta antes de terminar.
export const maxDuration = 3600;

export async function POST(request: Request) {
  // Recibe el array de objetos del Excel: [{ "GUID/ERP": "...", "Name": "..." }]
  const { url_base, usuario, contrasena, codigos } = await request.json();

  if (!url_base || !usuario || !contrasena || !codigos || codigos.length === 0) {
    return new Response(JSON.stringify({ type: 'error', error: "Faltan datos o la lista está vacía." }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let browser: Browser | null = null;
      let cerrado = false;

      // Si el cliente se va (pestaña cerrada, cancelación), dejamos de trabajar.
      const cancelado = () => request.signal.aborted;

      // Tras un abort el controller ya no acepta datos: enqueue lanzaría y taparía el error real.
      const enviar = (payload: unknown) => {
        if (cerrado || cancelado()) return;
        controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
      };
      const cerrar = () => {
        if (cerrado) return;
        cerrado = true;
        try { controller.close(); } catch { /* el cliente ya cerró el stream */ }
      };

      const sendLog = (msg: string) => enviar({ type: 'log', message: msg });
      const sendSuccess = (resultados: any[]) => enviar({ type: 'success', resultados });
      const sendError = (error: string) => enviar({ type: 'error', error });

      try {
        sendLog(`[Extractor] Iniciando motor para ${codigos.length} enunciados...`);

        browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',                
            '--disable-setuid-sandbox',    
            '--disable-dev-shm-usage',    
            '--disable-gpu'                
          ]
        });
        sendLog(`Navegador iniciado.`);

        const context = await browser.newContext({
          locale: 'es-ES',
          timezoneId: 'Europe/Madrid',
          extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' }
        });
        const page = await context.newPage();

        // --- LOGIN ---
        sendLog(`Accediendo a la plataforma...`);
        await page.goto(`${url_base}/auth/login`);

        await page.locator('input[type="text"], input[type="email"], input[name="username"]').first().fill(usuario);
        await page.locator('input[type="password"], input[name="password"]').first().fill(contrasena);
        await page.locator('button[type="submit"], button:has-text("Iniciar sesión"), button:has-text("Login")').first().click();
        
        sendLog(`Esperando sesión...`);
        
        // CORRECCIÓN: Esperamos obligatoriamente a que aparezca el botón de "Contenidos".
        // Si aparece, significa que las cookies de sesión ya están guardadas.
        await page.locator('div[aria-label="Contenidos"]').first().waitFor({ state: "visible", timeout: 15000 });
        await page.waitForTimeout(1000); // Pausa de cortesía extra de 1 segundo

        const resultados = [];

        // --- BUCLE DE RECOLECCIÓN ---
        for (let i = 0; i < codigos.length; i++) {
          if (cancelado()) {
            sendLog(`Extracción cancelada por el usuario.`);
            break;
          }

          const item = codigos[i];
          const guid = item["GUID/ERP"];
          const codigo = item["Name"];

          sendLog(`Extrayendo [${i + 1}/${codigos.length}]: ${codigo}...`);

          try {
            //URL directa al editor usando el GUID
            const targetUrl = `${url_base}/contents/activities/${guid}/2`;
        
            await page.goto(targetUrl);
            await page.waitForLoadState("networkidle");

            const bloqueEnunciado = page.locator('div[data-id="stimulus"]');

            try {
              await bloqueEnunciado.waitFor({ state: "visible", timeout: 8000 });
              const textareaOculto = bloqueEnunciado.locator('textarea').first();
              await textareaOculto.waitFor({ state: "attached", timeout: 3000 });

              // Extraemos HTML
              const descripcionHtml = await textareaOculto.evaluate((el: HTMLTextAreaElement) => el.value);
              resultados.push({ codigo, enunciadoHtml: descripcionHtml });
              
            } catch (e) {
              sendLog(`[⚠️] No se encontró el texto en el editor de ${codigo}.`);
              resultados.push({ codigo, enunciadoHtml: "[SIN ENUNCIADO EN EL EDITOR]" });
            }

          } catch (e) {
            sendLog(`[❌] Error inesperado en ${codigo}. Saltando al siguiente...`);
            resultados.push({ codigo, enunciadoHtml: "[ERROR DE NAVEGACIÓN]" });
          }
        }

        sendLog(`Extracción completada. ${resultados.length} procesados.`);
        sendSuccess(resultados);
        cerrar();

      } catch (error) {
        sendLog(`[❌] ERROR CRÍTICO en el Extractor.`);
        sendError(String(error));
        cerrar();
      } finally {
        // Sin esto, cualquier fallo deja un Chromium huérfano comiéndose la memoria del contenedor.
        await browser?.close().catch(() => { /* ya estaba cerrado */ });
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