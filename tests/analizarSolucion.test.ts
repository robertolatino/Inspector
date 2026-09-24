import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analizarSolucion } from '../lib/publisher/analizarSolucion.ts';

/**
 * Fixtures reconstruidos a partir de la estructura real (clases `lemo-*`)
 * comprobada en vivo contra actividades reales del backoffice de EPD — no son
 * HTML capturado literalmente (el editor de actividades no deja copiar HTML en
 * bruto), pero reproducen la jerarquía y las clases exactas que se verificaron
 * elemento a elemento.
 */

test('tabla: matriz V/F con celdas de respuesta con texto propio', () => {
  const pregunta = `
    <div class="lemo-question-body">
      <div class="lemo-table-body-item">
        <div class="lemo-table-grid">
          <div class="lemo-question-stem lemo-row-cell">Afirmación uno.</div>
          <div class="lemo-question-response lemo-row-cell">Cert</div>
          <div class="lemo-question-response lemo-row-cell">Fals</div>
        </div>
      </div>
    </div>
  `;
  const solucion = `
    <div class="lemo-question-body">
      <div class="lemo-table-body-item">
        <div class="lemo-table-grid">
          <div class="lemo-question-stem lemo-row-cell">Afirmación uno.</div>
          <div class="lemo-question-response lemo-row-cell lemo-selected">Cert</div>
          <div class="lemo-question-response lemo-row-cell">Fals</div>
        </div>
      </div>
      <div class="lemo-table-body-item">
        <div class="lemo-table-grid">
          <div class="lemo-question-stem lemo-row-cell">Afirmación dos.</div>
          <div class="lemo-question-response lemo-row-cell">Cert</div>
          <div class="lemo-question-response lemo-row-cell lemo-selected">Fals</div>
        </div>
      </div>
    </div>
  `;

  const detalle = analizarSolucion(pregunta, solucion);

  assert.equal(detalle.patron, 'tabla');
  assert.equal(detalle.tabla?.filas.length, 2);
  assert.equal(detalle.tabla?.filas[0].columnaCorrecta, 1);
  assert.equal(detalle.tabla?.filas[1].columnaCorrecta, 2);
  assert.deepEqual(detalle.tabla?.cabecera, ['', 'Cert', 'Fals']);
});

test('tabla: celdas de respuesta sin texto propio caen a "Columna N"', () => {
  const pregunta = `<div class="lemo-table-body-item"><div class="lemo-table-grid">
    <div class="lemo-question-stem lemo-row-cell">Fila</div>
    <div class="lemo-question-response lemo-row-cell"></div>
    <div class="lemo-question-response lemo-row-cell"></div>
  </div></div>`;
  const solucion = `<div class="lemo-table-body-item"><div class="lemo-table-grid">
    <div class="lemo-question-stem lemo-row-cell">Fila</div>
    <div class="lemo-question-response lemo-row-cell lemo-selected"></div>
    <div class="lemo-question-response lemo-row-cell"></div>
  </div></div>`;

  const detalle = analizarSolucion(pregunta, solucion);

  assert.equal(detalle.patron, 'tabla');
  assert.deepEqual(detalle.tabla?.cabecera, ['', 'Columna 1', 'Columna 2']);
  assert.equal(detalle.tabla?.filas[0].columnaCorrecta, 1);
});

test('opciones: respuesta única marcada con .lemo-selected', () => {
  const pregunta = `
    <div class="lemo-question-body lemo-with-columns">
      <div class="lemo-option lemo-column-1">Opción A</div>
      <div class="lemo-option lemo-column-1">Opción B</div>
      <div class="lemo-option lemo-column-1">Opción C</div>
    </div>
  `;
  const solucion = `
    <div class="lemo-question-body lemo-with-columns">
      <div class="lemo-option lemo-column-1">Opción A</div>
      <div class="lemo-option lemo-column-1 lemo-selected">Opción B</div>
      <div class="lemo-option lemo-column-1">Opción C</div>
    </div>
  `;

  const detalle = analizarSolucion(pregunta, solucion);

  assert.equal(detalle.patron, 'opciones');
  assert.equal(detalle.opciones?.length, 1);
  assert.equal(detalle.opciones?.[0].correcta, true);
  assert.match(detalle.opciones?.[0].html ?? '', /Opción B/);
});

test('opciones: selección múltiple marca varias correctas', () => {
  const solucion = `
    <div class="lemo-question-body">
      <div class="lemo-option lemo-selected">Uno</div>
      <div class="lemo-option lemo-selected">Dos</div>
      <div class="lemo-option">Tres</div>
    </div>
  `;

  const detalle = analizarSolucion('<div></div>', solucion);

  assert.equal(detalle.patron, 'opciones');
  assert.equal(detalle.opciones?.length, 2);
});

test('desplegable: se queda con la opción elegida, no con el hueco', () => {
  const solucion = `
    <span class="lemo-blank-item-container">
      <span class="lemo-label-blank-item-wrapper">
        <span class="lemo-blank lemo-selected">ga go gu gue gui</span>
      </span>
      <span class="lemo-dropdown-native">
        <span class="lemo-dropdown-native-select">
          <span class="lemo-dropdown-content-item lemo-base-dropdown__item lemo-selected lemo-dropdown-control__item--selected">go</span>
        </span>
      </span>
    </span>
  `;

  const detalle = analizarSolucion('<div></div>', solucion);

  assert.equal(detalle.patron, 'desplegable');
  assert.equal(detalle.opciones?.length, 1);
  assert.match(detalle.opciones?.[0].html ?? '', /^go$|>go</);
});

test('relleno: hueco de texto/número (.lemo-cloze-text-blank)', () => {
  const solucion = `
    <p>Resultado: <span class="lemo-editable-text lemo-cloze-text-blank">48,75</span> €</p>
  `;

  const detalle = analizarSolucion('<p>Resultado: <span class="lemo-editable-text lemo-cloze-text-blank"></span> €</p>', solucion);

  assert.equal(detalle.patron, 'relleno');
  assert.deepEqual(detalle.relleno, ['48,75']);
});

test('relleno: palabra arrastrada a un hueco (.lemo-drag-option.lemo-is-dropped)', () => {
  const solucion = `
    <div class="lemo-blank">
      <div class="lemo-drop-item">
        <div>
          <div class="lemo-drag-option lemo-drag-box lemo-is-dropped react-draggable">amigo</div>
          <div class="lemo-drop-area">amigo</div>
        </div>
      </div>
    </div>
  `;

  const detalle = analizarSolucion('<div></div>', solucion);

  assert.equal(detalle.patron, 'relleno');
  assert.deepEqual(detalle.relleno, ['amigo']);
});

test('orden: la solución trae las piezas ya en el orden correcto', () => {
  const pregunta = `
    <div class="lemo-question-body"><div class="lemo-option-list lemo-horizontal-list">
      <div>mare</div><div>Ma</div><div>Lola</div><div>es</div><div>diu</div>
    </div></div>
  `;
  const solucion = `
    <div class="lemo-question-body"><div class="lemo-option-list lemo-horizontal-list">
      <div>Ma</div><div>mare</div><div>es</div><div>diu</div><div>Lola</div>
    </div></div>
  `;

  const detalle = analizarSolucion(pregunta, solucion);

  assert.equal(detalle.patron, 'orden');
  assert.deepEqual(detalle.orden, ['Ma', 'mare', 'es', 'diu', 'Lola']);
});

test('sin_solucion: no hay panel de soluciones (p. ej. Matemáticas)', () => {
  const detalle = analizarSolucion('<p>Calcula 2+2.</p>', null);

  assert.equal(detalle.patron, 'sin_solucion');
  assert.equal(detalle.contenidoSinSolucion, '<p>Calcula 2+2.</p>');
});

test('sin_solucion: pregunta y solución idénticas (p. ej. Emparejar/Clasificar)', () => {
  const html = '<div class="lemo-question-body"><div>Uno</div><div>Dos</div></div>';

  const detalle = analizarSolucion(html, html);

  assert.equal(detalle.patron, 'sin_solucion');
});

test('sin_solucion: panel de soluciones vacío de texto', () => {
  const detalle = analizarSolucion('<p>Enunciado.</p>', '<div class="lemo-solutions-preview">   </div>');

  assert.equal(detalle.patron, 'sin_solucion');
});
