'use client';

import { useCallback, useRef, useState } from 'react';
import type { MensajeStream } from '@/lib/types';

/**
 * Lector del stream NDJSON del servidor, compartido por el recolector y el
 * extractor.
 *
 * Existe por un bug concreto: había dos copias de este bucle y solo una
 * bufferizaba las líneas incompletas. Un chunk de red que cortara un JSON por
 * la mitad hacía desaparecer el mensaje `success` —el más grande y por tanto el
 * más propenso a partirse—, así que la terminal anunciaba N resultados y la
 * pantalla se quedaba vacía. Con un solo lector el fallo no puede reaparecer en
 * una vista y no en la otra.
 */
export function useNdjsonStream<T>() {
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [ejecutando, setEjecutando] = useState(false);
  const abortoRef = useRef<AbortController | null>(null);

  const ejecutar = useCallback(async (url: string, cuerpo: unknown): Promise<T | null> => {
    const aborto = new AbortController();
    abortoRef.current = aborto;

    setEjecutando(true);
    setError('');
    setLogs([]);

    // Envuelto en un objeto: TypeScript no ve las asignaciones hechas dentro del
    // closure de `procesar` y estrecharía el tipo a null.
    const salida: { valor: T | null } = { valor: null };

    try {
      const respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: aborto.signal,
      });

      // Los errores de validación y de sesión son JSON normal, no NDJSON.
      if (!respuesta.ok) {
        const datos = await respuesta.json().catch(() => null);
        setError(datos?.error ?? `El servidor respondió ${respuesta.status}.`);
        return null;
      }
      if (!respuesta.body) {
        setError('El servidor no devolvió ningún flujo de datos.');
        return null;
      }

      const procesar = (linea: string) => {
        if (!linea.trim()) return;

        let mensaje: MensajeStream<T>;
        try {
          mensaje = JSON.parse(linea);
        } catch {
          console.error('Línea NDJSON ilegible:', linea);
          return;
        }

        if (mensaje.type === 'log') setLogs((prev) => [...prev, mensaje.message]);
        else if (mensaje.type === 'success') salida.valor = mensaje.data;
        else if (mensaje.type === 'error') setError(mensaje.error);
      };

      const lector = respuesta.body.getReader();
      const decodificador = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;

        buffer += decodificador.decode(value, { stream: true });
        const partes = buffer.split('\n');
        // El último trozo puede estar a medias: vuelve al buffer a esperar.
        buffer = partes.pop() ?? '';
        partes.forEach(procesar);
      }

      // Al cerrarse el stream puede quedar una línea sin '\n' final.
      procesar(buffer);

      return salida.valor;
    } catch (e) {
      // Cancelar es una acción del usuario, no un error que haya que mostrar.
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setError('Error de conexión con el servidor.');
      }
      return null;
    } finally {
      setEjecutando(false);
      abortoRef.current = null;
    }
  }, []);

  /** Aborta la petición: el servidor lo detecta y cierra su navegador. */
  const cancelar = useCallback(() => abortoRef.current?.abort(), []);

  return { logs, error, ejecutando, ejecutar, cancelar, setError };
}
