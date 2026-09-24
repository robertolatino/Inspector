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
    /** Cada <a> de esta celda es una actividad: el href lleva el GUID. */
    filaActividad: '.table-body-cell-subtitle a',
    /**
     * El <a> de una fila trae varios <span>: uno sin clase con el título
     * legible ("Relaciona las palabras") y este, con el código real
     * ("ENTRE_L1_LET_CQU_07"). Coger "el primer <span>" a secas devuelve el
     * título en vez del código, y como el filtro por prefijo compara contra
     * el código, ninguna fila coincide y la recolección vuelve 0 resultados
     * sin avisar de por qué.
     */
    codigoEnFila: 'span.subtitle',
    siguientePagina:
      'button[aria-label="Go to next page"], button[aria-label="Ir a la página siguiente"], ul.MuiPagination-ul li:last-child button',
  },

  editor: {
    /** Bloque del enunciado dentro del editor de la actividad. */
    bloqueEnunciado: 'div[data-id="stimulus"]',
    /** El textarea oculto del WYSIWYG: su `value` es el HTML real del enunciado. */
    textareaEnunciado: 'textarea',

    /**
     * Vista previa de la pregunta tal como la ve el alumno, sin marcar. Y su
     * equivalente dentro de "Soluciones" → pestaña "Solución" (ya renderizada
     * por defecto), con la clase `elementoSeleccionado` en la respuesta
     * correcta cuando el tipo de plantilla lo permite. Ver
     * `lib/publisher/analizarSolucion.ts` para cómo se interpretan.
     */
    vistaPreviaPregunta: '.lemo-question-preview',
    vistaPreviaSolucion: '.lemo-solutions-preview',
    elementoSeleccionado: '.lemo-selected',

    /** Estructura de una pregunta en forma de matriz/tabla (p. ej. V/F en cuadrícula). */
    tablaGrid: '.lemo-table-grid',
    tablaFila: '.lemo-table-body-item',
    tablaCeldaSeleccionada: '.lemo-question-response.lemo-row-cell.lemo-selected',

    /**
     * El campo "Nombre interno" es siempre el primer input de texto del
     * editor, en las 12 plantillas comprobadas en vivo (desde Respuesta única
     * hasta Matemáticas). Es el título legible de la actividad.
     */
    nombreInterno: 'input.lemo-editor-input-text',

    /**
     * El nodo raíz de la pregunta dentro de `vistaPreviaPregunta` lleva SIEMPRE
     * dos clases: `lemo-question` y una segunda que identifica el tipo de
     * plantilla (p. ej. `lemo-classify-linking-lines` = Unir). Ver
     * `lib/publisher/tipoPlantilla.ts` para la traducción a un nombre legible.
     */
    tipoPregunta: '.lemo-question-preview .lemo-question',
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
