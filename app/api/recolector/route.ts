import { chromium, type Browser } from 'playwright';

// El scrape vive dentro de la petición: sin esto la plataforma la corta antes de terminar.
export const maxDuration = 3600;

// Tope de seguridad: si la paginación nunca se deshabilita, el bucle no se vuelve infinito.
const MAX_PAGINAS = 200;

export async function POST(request: Request) {
  const { url_base, usuario, contrasena, codigo_libro } = await request.json();

  if (!url_base || !usuario || !contrasena || !codigo_libro) {
    return new Response(JSON.stringify({ type: 'error', error: "Faltan credenciales o el código del libro." }), { status: 400 });
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
      const sendSuccess = (codigos: any[]) => enviar({ type: 'success', codigos });
      const sendError = (error: string) => enviar({ type: 'error', error });

      try {
        sendLog(`Iniciando motor de recolección para: ${codigo_libro}...`);

        browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',                
            '--disable-setuid-sandbox',    
            '--disable-dev-shm-usage',    
            '--disable-gpu'                
          ]
        });
        sendLog(`Navegador  iniciado.`);

        const context = await browser.newContext({
          locale: 'es-ES',
          timezoneId: 'Europe/Madrid',
          extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' }
        });
        const page = await context.newPage();

        sendLog(`Accediendo a la plataforma y verificando credenciales...`);
        await page.goto(`${url_base}/auth/login`);

        await page.locator('input[type="text"], input[type="email"], input[name="username"]').first().fill(usuario);
        await page.locator('input[type="password"], input[name="password"]').first().fill(contrasena);
        await page.locator('button[type="submit"], button:has-text("Iniciar sesión"), button:has-text("Login")').first().click();
        await page.waitForLoadState("networkidle");

        sendLog(`Navegando a la sección de Actividades...`);
        await page.locator('div[aria-label="Contenidos"]').first().click();
        await page.waitForTimeout(1000);
        
        await page.locator('a[href="/contents/activities"]').first().click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1500);

        sendLog(`Escribiendo código padre en el buscador interno...`);
        const buscador = page.locator('input[data-testid="search"]');
        await buscador.fill("");
        await buscador.fill(codigo_libro);
        await buscador.press("Enter");

        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(3000);

        // Usamos un Map para evitar duplicados usando el GUID como clave única
        const codigosRecolectados = new Map<string, string>();
        let paginaActual = 1;

        while (paginaActual <= MAX_PAGINAS) {
          if (cancelado()) {
            sendLog(`Recolección cancelada por el usuario.`);
            break;
          }

          sendLog(`Analizando página ${paginaActual} de resultados...`);

          // Recogemos la etiqueta <a> entera para poder leer tanto el texto como el enlace
          const elementos = await page.locator('.table-body-cell-subtitle a').all();

          if (elementos.length === 0) {
            sendLog(`No hay elementos en la página ${paginaActual}. Terminado.`);
            break;
          }

          for (const el of elementos) {
            const href = await el.getAttribute('href');
            const name = await el.locator('span').first().innerText();
            
            if (href && name.trim()) {
              // Extraemos todo lo que hay después del último '/'
              const guid = href.split('/').pop();
              if (guid) {
                codigosRecolectados.set(guid, name.trim());
              }
            }
          }

          const btnSiguiente = page.locator('button[aria-label="Go to next page"], button[aria-label="Ir a la página siguiente"], ul.MuiPagination-ul li:last-child button').first();
          
          const isVisible = await btnSiguiente.isVisible();
          if (!isVisible) {
            sendLog(`Solo existe una página. Recolección finalizada.`);
            break;
          }

          const isDisabled = await btnSiguiente.isDisabled();
          if (isDisabled) {
            sendLog(`Última página alcanzada. Recolección finalizada.`);
            break;
          }

          sendLog(`Pasando a la siguiente página...`);
          await btnSiguiente.click();
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(2000);

          paginaActual++;
        }

        if (paginaActual > MAX_PAGINAS) {
          sendLog(`Alcanzado el tope de ${MAX_PAGINAS} páginas: se detiene la recolección por seguridad.`);
        }

        // Formateamos los resultados en un array de objetos y los ordenamos alfabéticamente por el nombre del código
        const listaOrdenada = Array.from(codigosRecolectados.entries())
          .map(([guid, name]) => ({
            "GUID/ERP": guid,
            "Name": name
          }))
          // Ordenamos alfabéticamente por el código de actividad
          .sort((a, b) => a.Name.localeCompare(b.Name));

        sendLog(`${listaOrdenada.length} códigos listos.`);
        sendSuccess(listaOrdenada);
        cerrar();

      } catch (error) {
        sendLog(`ERROR CRÍTICO: El motor se ha detenido.`);
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