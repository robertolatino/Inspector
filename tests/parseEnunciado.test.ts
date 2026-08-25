import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsearEnunciado } from '../lib/html/parseEnunciado.ts';

/** Texto plano de un bloque, para comparar sin ruido de estilos. */
const textoDe = (bloque: { fragmentos: { texto: string; salto?: true }[] }) =>
  bloque.fragmentos.map((f) => (f.salto ? '\n' : f.texto)).join('');

test('un enunciado vacío no genera bloques', () => {
  assert.deepEqual(parsearEnunciado(''), []);
  assert.deepEqual(parsearEnunciado('   '), []);
});

test('cada <p> es un párrafo independiente', () => {
  const bloques = parsearEnunciado('<p>Primero</p><p>Segundo</p>');

  assert.equal(bloques.length, 2);
  assert.equal(textoDe(bloques[0]), 'Primero');
  assert.equal(textoDe(bloques[1]), 'Segundo');
});

test('<br> es un salto dentro del mismo párrafo, no un párrafo nuevo', () => {
  const bloques = parsearEnunciado('<p>Uno<br>Dos</p>');

  assert.equal(bloques.length, 1);
  assert.equal(textoDe(bloques[0]), 'Uno\nDos');
});

test('los estilos se heredan al anidarse', () => {
  const bloques = parsearEnunciado('<p>Normal <b>negrita <i>y cursiva</i></b></p>');
  const [normal, negrita, ambos] = bloques[0].fragmentos;

  assert.deepEqual(
    { texto: normal.texto, negrita: normal.negrita, cursiva: normal.cursiva },
    { texto: 'Normal ', negrita: false, cursiva: false },
  );
  assert.deepEqual(
    { texto: negrita.texto, negrita: negrita.negrita, cursiva: negrita.cursiva },
    { texto: 'negrita ', negrita: true, cursiva: false },
  );
  assert.deepEqual(
    { texto: ambos.texto, negrita: ambos.negrita, cursiva: ambos.cursiva },
    { texto: 'y cursiva', negrita: true, cursiva: true },
  );
});

test('<strong>, <em> y <u> equivalen a <b>, <i> y subrayado', () => {
  const [bloque] = parsearEnunciado('<p><strong>a</strong><em>b</em><u>c</u></p>');

  assert.equal(bloque.fragmentos[0].negrita, true);
  assert.equal(bloque.fragmentos[1].cursiva, true);
  assert.equal(bloque.fragmentos[2].subrayado, true);
});

test('cada <li> es un bloque con viñeta', () => {
  const bloques = parsearEnunciado('<ul><li>Uno</li><li>Dos</li></ul>');

  assert.equal(bloques.length, 2);
  assert.deepEqual(
    bloques.map((b) => [textoDe(b), b.vineta]),
    [
      ['Uno', 0],
      ['Dos', 0],
    ],
  );
});

test('las listas anidadas suben de nivel de viñeta', () => {
  const bloques = parsearEnunciado('<ul><li>Padre<ul><li>Hija</li></ul></li></ul>');

  assert.deepEqual(
    bloques.map((b) => [textoDe(b), b.vineta]),
    [
      ['Padre', 0],
      ['Hija', 1],
    ],
  );
});

test('un salto de línea del código fuente separa palabras en lugar de pegarlas', () => {
  // El parser anterior borraba los '\n' sin más y producía "unadospalabras".
  const [bloque] = parsearEnunciado('<p>una\ndos\npalabras</p>');

  assert.equal(textoDe(bloque), 'una dos palabras');
});

test('el texto sin etiquetas también produce un bloque', () => {
  // Es el caso de los marcadores tipo [SIN ENUNCIADO EN EL EDITOR].
  const bloques = parsearEnunciado('[SIN ENUNCIADO EN EL EDITOR]');

  assert.equal(bloques.length, 1);
  assert.equal(textoDe(bloques[0]), '[SIN ENUNCIADO EN EL EDITOR]');
});

test('los bloques que solo tienen espacios se descartan', () => {
  assert.deepEqual(parsearEnunciado('<p> </p><p>Contenido</p>').map(textoDe), ['Contenido']);
});
