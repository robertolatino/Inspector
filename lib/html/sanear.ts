import * as cheerio from 'cheerio';

/**
 * Saneado del HTML de los enunciados con lista blanca.
 *
 * El enunciado sale del editor del publisher y acaba dentro de un
 * `dangerouslySetInnerHTML` en la vista previa. Antes solo se borraban las
 * etiquetas `<img>` con una expresión regular, que dejaba pasar cualquier otro
 * vector (`<svg onload>`, `<iframe>`, atributos `on*`...). Se aplica en el
 * servidor, así que el cliente nunca recibe HTML sin sanear.
 *
 * Usa cheerio, que ya era dependencia del proyecto: no añade nada nuevo.
 */

/** Etiquetas que aportan formato al enunciado y se conservan. */
const PERMITIDAS = new Set([
  'p', 'br', 'div', 'span',
  'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'a', 'code', 'pre',
]);

/** Etiquetas que se eliminan con su contenido incluido. */
const ELIMINADAS = [
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
  'link', 'meta', 'base', 'form', 'input', 'button', 'textarea',
  'audio', 'video', 'source', 'track',
].join(',');

const ATRIBUTOS_PERMITIDOS = new Set(['colspan', 'rowspan']);

/**
 * Las imágenes no se pueden mostrar (están detrás de la sesión de la
 * plataforma) y antes desaparecían sin dejar rastro, lo que en Matemáticas o
 * Infantil puede ser media actividad. Se sustituyen por un marcador visible que
 * llega igual a la vista previa y al Word.
 */
export const MARCADOR_IMAGEN = '[IMAGEN]';

export function sanearHtmlEnunciado(html: string): string {
  if (!html) return '';

  const $ = cheerio.load(html);

  $(ELIMINADAS).remove();
  $('img').replaceWith(MARCADOR_IMAGEN);

  $('body')
    .find('*')
    .each((_, el) => {
      const nodo = $(el);
      const etiqueta = el.tagName?.toLowerCase();

      if (!etiqueta || !PERMITIDAS.has(etiqueta)) {
        // Etiqueta desconocida: se descarta la etiqueta pero se conserva el texto.
        nodo.replaceWith(nodo.contents());
        return;
      }

      for (const atributo of Object.keys(el.attribs ?? {})) {
        const nombre = atributo.toLowerCase();

        if (ATRIBUTOS_PERMITIDOS.has(nombre)) continue;

        // Un enlace http(s) es legítimo; javascript:/data: no.
        if (nombre === 'href' && etiqueta === 'a') {
          const valor = (el.attribs[atributo] ?? '').trim();
          if (/^https?:\/\//i.test(valor)) continue;
        }

        nodo.removeAttr(atributo);
      }
    });

  return $('body').html() ?? '';
}
