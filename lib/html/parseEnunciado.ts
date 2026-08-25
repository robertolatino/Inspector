import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

/**
 * Parser del HTML de los enunciados a una estructura plana de bloques.
 *
 * Está separado de la generación del `.docx` a propósito: aquí vive toda la
 * lógica —qué etiquetas cortan párrafo, cómo se heredan los estilos, cómo se
 * anidan las listas— y es una función pura, así que se puede testear sin
 * inspeccionar objetos internos de la librería `docx`.
 *
 * El problema que resuelve: antes todo el contenido de una actividad acababa en
 * un único párrafo y `</p>` solo añadía un espacio, así que párrafos, saltos de
 * línea y listas se aplastaban en un churro de texto.
 */

export interface Fragmento {
  texto: string;
  negrita: boolean;
  cursiva: boolean;
  subrayado: boolean;
  /** true = salto de línea dentro del mismo párrafo (`<br>`). */
  salto?: true;
}

export interface Bloque {
  fragmentos: Fragmento[];
  /** Nivel de viñeta (0 = primer nivel) o null si no es un elemento de lista. */
  vineta: number | null;
}

interface Estilo {
  negrita: boolean;
  cursiva: boolean;
  subrayado: boolean;
}

const SIN_ESTILO: Estilo = { negrita: false, cursiva: false, subrayado: false };

/** Etiquetas que fuerzan un párrafo nuevo. */
const BLOQUE = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'table', 'tr', 'td', 'th',
]);

const NEGRITA = new Set(['b', 'strong']);
const CURSIVA = new Set(['i', 'em']);

export function parsearEnunciado(html: string): Bloque[] {
  if (!html.trim()) return [];

  const $ = cheerio.load(html);
  const bloques: Bloque[] = [];

  let fragmentos: Fragmento[] = [];
  let vineta: number | null = null;

  const cerrarBloque = () => {
    // Un bloque con solo saltos de línea no aporta nada.
    if (!fragmentos.some((f) => !f.salto && f.texto.trim() !== '')) {
      fragmentos = [];
      return;
    }
    bloques.push({ fragmentos, vineta });
    fragmentos = [];
  };

  const recorrer = (nodos: AnyNode[], estilo: Estilo, profundidadLista: number) => {
    for (const nodo of nodos) {
      if (nodo.type === 'text') {
        // Los saltos de línea del código fuente no son contenido, pero sí
        // separan palabras: colapsarlos a un espacio evita que se peguen.
        const texto = nodo.data.replace(/\s*\n\s*/g, ' ');
        if (texto) fragmentos.push({ texto, ...estilo });
        continue;
      }

      if (nodo.type !== 'tag') continue;

      const etiqueta = nodo.name.toLowerCase();

      if (etiqueta === 'br') {
        fragmentos.push({ texto: '', ...estilo, salto: true });
        continue;
      }

      const estiloHijo: Estilo = {
        negrita: estilo.negrita || NEGRITA.has(etiqueta),
        cursiva: estilo.cursiva || CURSIVA.has(etiqueta),
        subrayado: estilo.subrayado || etiqueta === 'u',
      };

      if (etiqueta === 'ul' || etiqueta === 'ol') {
        cerrarBloque();
        recorrer(nodo.children, estiloHijo, profundidadLista + 1);
        continue;
      }

      if (etiqueta === 'li') {
        cerrarBloque();
        vineta = Math.max(0, profundidadLista - 1);
        recorrer(nodo.children, estiloHijo, profundidadLista);
        cerrarBloque();
        vineta = null;
        continue;
      }

      if (BLOQUE.has(etiqueta)) {
        cerrarBloque();
        recorrer(nodo.children, estiloHijo, profundidadLista);
        cerrarBloque();
        continue;
      }

      // Etiqueta en línea: solo aporta estilo.
      recorrer(nodo.children, estiloHijo, profundidadLista);
    }
  };

  recorrer($('body').contents().toArray(), SIN_ESTILO, 0);
  cerrarBloque();

  return bloques;
}
