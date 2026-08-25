import assert from 'node:assert/strict';
import { test } from 'node:test';

import { abrir, sellar } from '../lib/sello.ts';

process.env.SESSION_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres';

const SESION = {
  usuario: 'alguien@edelvives.es',
  plataforma: 'EPD' as const,
  storageState: JSON.stringify({ cookies: [{ name: 'sid', value: 'abc' }], origins: [] }),
};

test('lo sellado se puede volver a abrir intacto', () => {
  assert.deepEqual(abrir(sellar(SESION)), SESION);
});

test('el sello no expone el contenido en claro', () => {
  const sellado = sellar(SESION);

  assert.equal(sellado.includes('edelvives'), false);
  assert.equal(sellado.includes('sid'), false);
});

test('dos sellos de la misma sesión son distintos', () => {
  // IV aleatorio por sellado: si dos sellos iguales, se estaría reutilizando.
  assert.notEqual(sellar(SESION), sellar(SESION));
});

test('una cookie manipulada devuelve null en lugar de datos', () => {
  const sellado = sellar(SESION);
  const alterado = sellado.slice(0, -4) + (sellado.endsWith('AAAA') ? 'BBBB' : 'AAAA');

  assert.equal(abrir(alterado), null);
});

test('la basura y las cadenas cortas devuelven null', () => {
  assert.equal(abrir(''), null);
  assert.equal(abrir('no-es-un-sello'), null);
  assert.equal(abrir('AAAA'), null);
});

test('un secreto distinto no puede abrir el sello', () => {
  // Es lo que ocurre al rotar SESION_SECRET: las sesiones caducan, no se filtran.
  const sellado = sellar(SESION);

  process.env.SESSION_SECRET = 'otro-secreto-igualmente-largo-de-32-mas';
  assert.equal(abrir(sellado), null);

  process.env.SESSION_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres';
});

test('sin SESSION_SECRET falla en lugar de usar una clave por defecto', () => {
  const previo = process.env.SESSION_SECRET;

  delete process.env.SESSION_SECRET;
  assert.throws(() => sellar(SESION), /SESSION_SECRET/);

  process.env.SESSION_SECRET = 'corto';
  assert.throws(() => sellar(SESION), /SESSION_SECRET/);

  process.env.SESSION_SECRET = previo;
});
