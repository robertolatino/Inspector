import type { MensajeStream } from './types';

/**
 * Canal de progreso hacia el cliente. Lo reciben los motores de scraping para
 * emitir logs sin saber nada de streams ni de HTTP.
 */
export interface CanalNdjson<T> {
  log(mensaje: string): void;
  exito(data: T): void;
  error(mensaje: string): void;
  /** true si el cliente se fue: los bucles largos deben consultarlo y parar. */
  cancelado(): boolean;
}

/**
 * Envuelve un trabajo largo en una respuesta NDJSON (una línea de JSON por
 * mensaje).
 *
 * Centralizarlo aquí resuelve tres cosas que antes estaban copiadas —y a medias—
 * en cada ruta: el `finally` que cierra el stream, ignorar los envíos posteriores
 * a un abort (`enqueue` lanzaría y taparía el error real) y convertir cualquier
 * excepción en un mensaje de error legible en lugar de un stream cortado.
 */
export function respuestaNdjson<T>(
  signal: AbortSignal,
  trabajo: (canal: CanalNdjson<T>) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let cerrado = false;

      const enviar = (mensaje: MensajeStream<T>) => {
        if (cerrado || signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(mensaje) + '\n'));
        } catch {
          cerrado = true; // el cliente cerró el stream por su lado
        }
      };

      const canal: CanalNdjson<T> = {
        log: (mensaje) => enviar({ type: 'log', message: mensaje }),
        exito: (data) => enviar({ type: 'success', data }),
        error: (mensaje) => enviar({ type: 'error', error: mensaje }),
        cancelado: () => signal.aborted,
      };

      try {
        await trabajo(canal);
      } catch (e) {
        canal.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cerrado) {
          cerrado = true;
          try {
            controller.close();
          } catch {
            /* ya estaba cerrado */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      // no-transform es imprescindible: un proxy que bufferice rompe el streaming.
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
