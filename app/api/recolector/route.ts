import { chromium } from 'playwright';

export async function POST(request: Request) {
  const { url_base, usuario, contrasena, codigo_libro } = await request.json();

  if (!url_base || !usuario || !contrasena || !codigo_libro) {
    return new Response(JSON.stringify({ type: 'error', error: "Faltan credenciales o el código del libro." }), { status: 400 });
  }

  const encoder = new TextEncoder();

  // Creamos un "Tubo de transmisión en vivo" (ReadableStream)
  const stream = new ReadableStream({
    async start(controller) {

      // Funciones auxiliares para enviar datos por el "tubo"
      const sendLog = (msg: string) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'log', message: msg }) + '\n'));
      };
      const sendSuccess = (codigos: string[]) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'success', codigos }) + '\n'));
      };
      const sendError = (error: string) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error }) + '\n'));
      };

      try {
        sendLog(`[🤖] Iniciando motor de recolección para: ${codigo_libro}...`);

        // 1. Iniciamos el navegador
        const browser = await chromium.launch({
          headless: true, // Ponlo en false si quieres ver el navegador trabajando
          args: [
            '--no-sandbox',                
            '--disable-setuid-sandbox',    
            '--disable-dev-shm-usage',    
            '--disable-gpu'                
          ]
        });
        sendLog(`[🔌] Navegador virtual iniciado en segundo plano.`);

        const context = await browser.newContext({
          locale: 'es-ES',
          timezoneId: 'Europe/Madrid',
          extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' }
        });
        const page = await context.newPage();

        // --- NAVEGACIÓN Y LOGIN ---
        sendLog(`[🔐] Accediendo a la plataforma y verificando credenciales...`);
        await page.goto(`${url_base}/auth/login`);

        await page.locator('input[type="text"], input[type="email"], input[name="username"]').first().fill(usuario);
        await page.locator('input[type="password"], input[name="password"]').first().fill(contrasena);
        await page.locator('button[type="submit"], button:has-text("Iniciar sesión"), button:has-text("Login")').first().click();

        await page.waitForLoadState("networkidle");

        // Ir a Contenidos y luego a la pestaña de Actividades
        sendLog(`[📂] Navegando a la sección de Actividades...`);
        await page.locator('div[aria-label="Contenidos"]').first().click();
        await page.waitForTimeout(1000);
        
        await page.locator('a[href="/contents/activities"]').first().click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1500);

        // 3. BUSCAMOS EL LIBRO
        sendLog(`[🔎] Escribiendo código padre en el buscador interno...`);
        const buscador = page.locator('input[data-testid="search"]');
        await buscador.fill("");
        await buscador.fill(codigo_libro);
        await buscador.press("Enter");

        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(3000);

        // (ELIMINADO EL PASO 4 DE FILTROS. VAMOS DIRECTO A RECOLECTAR)

        const codigosRecolectados = new Set<string>();
        let paginaActual = 1;

        // --- BUCLE DE RECOLECCIÓN ---
        while (true) {
          sendLog(`[📖] Analizando página ${paginaActual} de resultados...`);

        // Recogemos SOLO el primer <span> dentro del enlace en la nueva estructura de la tabla
          const elementos = await page.locator('.table-body-cell-subtitle a span:first-child').all();

          if (elementos.length === 0) {
            sendLog(`[ℹ️] No hay elementos en la página ${paginaActual}. Terminado.`);
            break;
          }

          for (const el of elementos) {
            const codigo = await el.innerText();
            // Validamos que realmente tenga contenido antes de añadirlo
            if (codigo.trim()) {
              codigosRecolectados.add(codigo.trim());
            }
          }

          const btnSiguiente = page.locator('button[aria-label="Go to next page"], button[aria-label="Ir a la página siguiente"], ul.MuiPagination-ul li:last-child button').first();

          const isVisible = await btnSiguiente.isVisible();
          if (!isVisible) {
            sendLog(`[✅] Solo existe una página. Recolección finalizada.`);
            break;
          }

          const isDisabled = await btnSiguiente.isDisabled();
          if (isDisabled) {
            sendLog(`[✅] Última página alcanzada. Recolección finalizada.`);
            break;
          }

          sendLog(`[➡️] Pasando a la siguiente página...`);
          await btnSiguiente.click();
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(2000);

          paginaActual++;
        }

        await browser.close();

        // 5. Devolvemos el resultado final
        const listaOrdenada = Array.from(codigosRecolectados).sort();
        sendLog(`[🎉] ¡Éxito! Navegador cerrado. ${listaOrdenada.length} códigos listos.`);
        sendSuccess(listaOrdenada);

        // Cerramos el tubo de transmisión
        controller.close();

      } catch (error) {
        sendLog(`[❌] ERROR CRÍTICO: El robot se ha detenido.`);
        sendError(String(error));
        controller.close();
      }
    }
  });

  // Enviamos la respuesta como un flujo de datos continuo (NDJSON)
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}