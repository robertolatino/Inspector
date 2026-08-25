'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Estado que sobrevive a una recarga de la pestaña.
 *
 * Una extracción larga puede tardar bastante y sus resultados vivían solo en
 * `useState`: cualquier recarga accidental obligaba a repetirla entera.
 *
 * `sessionStorage` es un almacén externo a React y no existe en el servidor, así
 * que se lee con `useSyncExternalStore` en lugar de con un efecto: evita el
 * desajuste de hidratación y los renders en cascada.
 */

/**
 * `getSnapshot` debe devolver la misma referencia mientras el valor no cambie o
 * React entra en un bucle de renders, así que memorizamos por clave el JSON
 * crudo junto con su versión ya parseada.
 */
const cache = new Map<string, { crudo: string | null; valor: unknown }>();
const oyentes = new Map<string, Set<() => void>>();

function suscribir(clave: string, alCambiar: () => void): () => void {
  let conjunto = oyentes.get(clave);
  if (!conjunto) {
    conjunto = new Set();
    oyentes.set(clave, conjunto);
  }
  conjunto.add(alCambiar);
  return () => {
    conjunto.delete(alCambiar);
  };
}

function leer<T>(clave: string, inicial: T): T {
  let crudo: string | null = null;
  try {
    crudo = sessionStorage.getItem(clave);
  } catch {
    /* almacenamiento no disponible */
  }

  const previo = cache.get(clave);
  if (previo && previo.crudo === crudo) return previo.valor as T;

  let valor = inicial;
  if (crudo !== null) {
    try {
      valor = JSON.parse(crudo) as T;
    } catch {
      /* JSON corrupto: nos quedamos con el inicial */
    }
  }

  cache.set(clave, { crudo, valor });
  return valor;
}

function escribir<T>(clave: string, valor: T): void {
  const crudo = JSON.stringify(valor);
  cache.set(clave, { crudo, valor });

  try {
    sessionStorage.setItem(clave, crudo);
  } catch {
    /* cuota superada: no es motivo para romper la vista */
  }

  oyentes.get(clave)?.forEach((notificar) => notificar());
}

/**
 * `inicial` debe ser una referencia estable (una constante a nivel de módulo):
 * un literal en línea cambiaría de identidad en cada render.
 */
export function useEstadoPersistido<T>(clave: string, inicial: T) {
  const valor = useSyncExternalStore(
    useCallback((alCambiar: () => void) => suscribir(clave, alCambiar), [clave]),
    useCallback(() => leer(clave, inicial), [clave, inicial]),
    useCallback(() => inicial, [inicial]),
  );

  const establecer = useCallback((nuevo: T) => escribir(clave, nuevo), [clave]);

  return [valor, establecer] as const;
}
