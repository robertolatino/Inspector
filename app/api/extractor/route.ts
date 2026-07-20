import { chromium } from 'playwright';

export async function POST(request: Request) {
  // Recibe el array de objetos del Excel: [{ "GUID/ERP": "...", "Name": "..." }]
  const { url_base, usuario, contrasena, codigos } = await request.json();

  if (!url_base || !usuario || !contrasena || !codigos || codigos.length === 0) {
    return new Response(JSON.stringify({ type: 'error', error: "Faltan datos o la lista está vacía." }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendLog = (msg: string) => controller.enqueue(encoder.encode(JSON.stringify({ type: 'log', message: msg }) + '\n'));
      const sendSuccess = (resultados: any[]) => controller.enqueue(encoder.encode(JSON.stringify({ type: 'success', resultados }) + '\n'));
      const sendError = (error: string) => controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error }) + '\n'));

      try {
        sendLog(`[Extractor] Iniciando motor para ${codigos.length} enunciados...`);

        const browser = await chromium.launch({
          headless: false, // Puedes ponerlo en true cuando compruebes que va bien
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
        
        // CORRECCIÓN CLAVE: Esperamos obligatoriamente a que aparezca el botón de "Contenidos".
        // Si aparece, significa que las cookies de sesión ya están guardadas.
        await page.locator('div[aria-label="Contenidos"]').first().waitFor({ state: "visible", timeout: 15000 });
        await page.waitForTimeout(1000); // Pausa de cortesía extra de 1 segundo

        const resultados = [];

        // --- BUCLE TURBO (NAVEGACIÓN DIRECTA) ---
        for (let i = 0; i < codigos.length; i++) {
          const item = codigos[i];
          const guid = item["GUID/ERP"];
          const codigo = item["Name"];

          sendLog(`Extrayendo [${i + 1}/${codigos.length}]: ${codigo}...`);

          try {
            // Construimos la URL directa al editor usando el GUID
            const targetUrl = `${url_base}/contents/activities/${guid}/2`;
            
            // Navegamos directamente a la actividad logueados
            await page.goto(targetUrl);
            await page.waitForLoadState("networkidle");

            const bloqueEnunciado = page.locator('div[data-id="stimulus"]');

            try {
              // Esperamos a que cargue el bloque de edición
              await bloqueEnunciado.waitFor({ state: "visible", timeout: 8000 });
              const textareaOculto = bloqueEnunciado.locator('textarea').first();
              await textareaOculto.waitFor({ state: "attached", timeout: 3000 });

              // Extraemos el HTML
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

        await browser.close();

        sendLog(`Extracción completada. ${resultados.length} procesados.`);
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