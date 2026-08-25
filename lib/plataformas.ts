import type { PlataformaId } from './types';

/**
 * Catálogo de plataformas.
 *
 * Importante: la URL base la decide **el servidor** a partir del id. Antes el
 * cliente enviaba `url_base` y el servidor tecleaba las credenciales del
 * usuario en la dirección que le dijeran — lo que además convertía el
 * contenedor en un proxy de navegación arbitraria. El cliente solo manda el id
 * (usa `nombre` para las etiquetas del desplegable).
 */
export const PLATAFORMAS = {
  EPD: {
    id: 'EPD',
    nombre: 'Edelvives Digital Plus',
    urlBase: 'https://publisher.edelvivesdigitalplus.com',
  },
  BYME: {
    id: 'BYME',
    nombre: 'ByME Digital',
    urlBase: 'https://publisher.bymedigital.com',
  },
} as const satisfies Record<PlataformaId, { id: PlataformaId; nombre: string; urlBase: string }>;

export const PLATAFORMAS_LISTA = Object.values(PLATAFORMAS);

export function esPlataformaId(valor: unknown): valor is PlataformaId {
  return typeof valor === 'string' && Object.hasOwn(PLATAFORMAS, valor);
}

export function urlBaseDe(id: PlataformaId): string {
  return PLATAFORMAS[id].urlBase;
}
