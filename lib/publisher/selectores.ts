/**
 * Todos los selectores del publisher, en un solo sitio.
 *
 * El backoffice es una aplicación de terceros que cambia sin avisar: el
 * historial del repo ya tiene un commit "actualizando selectores para que
 * funcione con la nueva versión de la página". Cuando vuelva a pasar, este debe
 * ser el único archivo que haya que tocar.
 */
export const SELECTORES = {
  login: {
    ruta: '/auth/login',
    usuario: 'input[type="text"], input[type="email"], input[name="username"]',
    contrasena: 'input[type="password"], input[name="password"]',
    enviar: 'button[type="submit"], button:has-text("Iniciar sesión"), button:has-text("Login")',
  },

  /**
   * Presencia de este elemento = sesión válida. Es el marcador que usamos para
   * distinguir "credenciales correctas" de "credenciales rechazadas".
   */
  marcadorSesion: 'div[aria-label="Contenidos"]',

  navegacion: {
    menuContenidos: 'div[aria-label="Contenidos"]',
    enlaceActividades: 'a[href="/contents/activities"]',
    rutaActividades: '/contents/activities',
  },

  listado: {
    buscador: 'input[data-testid="search"]',
    /** Cada <a> de esta celda es una actividad: el href lleva el GUID y el <span> el código. */
    filaActividad: '.table-body-cell-subtitle a',
    siguientePagina:
      'button[aria-label="Go to next page"], button[aria-label="Ir a la página siguiente"], ul.MuiPagination-ul li:last-child button',
  },

  editor: {
    /** Bloque del enunciado dentro del editor de la actividad. */
    bloqueEnunciado: 'div[data-id="stimulus"]',
    /** El textarea oculto del WYSIWYG: su `value` es el HTML real del enunciado. */
    textareaEnunciado: 'textarea',
  },
} as const;

/**
 * URL directa al editor de una actividad. El `/2` es el índice de la pestaña
 * del enunciado dentro del editor; ir directos por GUID evita volver a buscar
 * la actividad en el listado.
 */
export function rutaEditorActividad(guid: string): string {
  return `/contents/activities/${encodeURIComponent(guid)}/2`;
}
