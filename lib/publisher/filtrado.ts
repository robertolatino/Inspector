import type { ActividadRef } from '../types';

/**
 * Deja solo las actividades cuyo código empieza por el código padre, ordenadas.
 *
 * Es la garantía final, independiente de lo que haga el buscador de la
 * plataforma: sin esto, cualquier desincronización con el filtro de la tabla se
 * cuela en el Excel. Ocurrió — una búsqueda de 70 actividades devolvió 100, con
 * 30 de otros libros (REL, TIL, e incluso una llamada "Lemonade").
 *
 * Vive en su propio módulo, sin dependencias de Playwright, para poder testearse
 * sin levantar un navegador.
 */
export function filtrarPorPrefijo(
  actividades: ActividadRef[],
  codigoLibro: string,
): ActividadRef[] {
  const prefijo = codigoLibro.trim().toLocaleUpperCase('es');

  return actividades
    .filter((a) => a.Name.trim().toLocaleUpperCase('es').startsWith(prefijo))
    .sort((a, b) => a.Name.localeCompare(b.Name, 'es'));
}
