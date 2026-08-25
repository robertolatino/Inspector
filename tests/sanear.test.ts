import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MARCADOR_IMAGEN, sanearHtmlEnunciado } from '../lib/html/sanear.ts';

/**
 * El saneador es un control de seguridad: su salida acaba en un
 * `dangerouslySetInnerHTML`. Estos tests fijan lo que NO debe pasar.
 */

test('conserva el formato legítimo del enunciado', () => {
  const html = '<p>Calcula <b>2 + 2</b> y escribe el <i>resultado</i>.</p>';

  assert.equal(sanearHtmlEnunciado(html), html);
});

test('elimina las etiquetas ejecutables con su contenido', () => {
  const limpio = sanearHtmlEnunciado('<p>Antes</p><script>alert(1)</script><p>Después</p>');

  assert.equal(limpio.includes('script'), false);
  assert.equal(limpio.includes('alert'), false);
  assert.equal(limpio, '<p>Antes</p><p>Después</p>');
});

test('elimina los atributos de evento', () => {
  // El saneador anterior era una regex que solo borraba <img>: esto pasaba.
  const limpio = sanearHtmlEnunciado('<p onclick="robar()">Texto</p>');

  assert.equal(limpio.includes('onclick'), false);
  assert.equal(limpio, '<p>Texto</p>');
});

test('elimina <svg> y <iframe>, que la regex anterior no tocaba', () => {
  const limpio = sanearHtmlEnunciado(
    '<svg onload="alert(1)"></svg><iframe src="http://malo"></iframe><p>Bien</p>',
  );

  assert.equal(limpio, '<p>Bien</p>');
});

test('sustituye las imágenes por un marcador visible', () => {
  const limpio = sanearHtmlEnunciado('<p>Mira <img src="x.png" onerror="alert(1)"> esto</p>');

  assert.equal(limpio.includes('<img'), false);
  assert.equal(limpio.includes('onerror'), false);
  assert.equal(limpio.includes(MARCADOR_IMAGEN), true);
});

test('desenvuelve las etiquetas desconocidas pero conserva el texto', () => {
  assert.equal(sanearHtmlEnunciado('<p>Uno <custom-tag>dos</custom-tag></p>'), '<p>Uno dos</p>');
});

test('permite enlaces http(s) y descarta el resto de protocolos', () => {
  assert.equal(
    sanearHtmlEnunciado('<a href="https://edelvives.es">ok</a>'),
    '<a href="https://edelvives.es">ok</a>',
  );
  assert.equal(sanearHtmlEnunciado('<a href="javascript:alert(1)">no</a>'), '<a>no</a>');
});

test('conserva las listas y sus atributos de tabla útiles', () => {
  assert.equal(
    sanearHtmlEnunciado('<ul><li>Uno</li></ul>'),
    '<ul><li>Uno</li></ul>',
  );
  // El parser inserta el <tbody> implícito, que es lo que manda el estándar.
  assert.equal(
    sanearHtmlEnunciado('<table><tr><td colspan="2" style="color:red">a</td></tr></table>'),
    '<table><tbody><tr><td colspan="2">a</td></tr></tbody></table>',
  );
});

test('un enunciado vacío devuelve cadena vacía', () => {
  assert.equal(sanearHtmlEnunciado(''), '');
});
