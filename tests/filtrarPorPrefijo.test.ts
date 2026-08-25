import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filtrarPorPrefijo } from '../lib/publisher/filtrado.ts';
import type { ActividadRef } from '../lib/types.ts';

const act = (nombre: string): ActividadRef => ({ 'GUID/ERP': `guid-${nombre}`, Name: nombre });

const nombres = (lista: ActividadRef[]) => lista.map((a) => a.Name);

test('descarta las actividades de otros libros', () => {
  // Caso real: una búsqueda de 225252_MAT1_U06 devolvió actividades de REL, TIL
  // y una llamada "Lemonade" porque se leyó la tabla antes de aplicar el filtro.
  const recolectadas = [
    act('225252_MAT1_U06_126_01'),
    act('197961_REL6_SA8_P98_05'),
    act('225252_MAT1_U06_128_02'),
    act('FP_I0094_U4_03'),
    act('Lemonade'),
  ];

  assert.deepEqual(nombres(filtrarPorPrefijo(recolectadas, '225252_MAT1_U06')), [
    '225252_MAT1_U06_126_01',
    '225252_MAT1_U06_128_02',
  ]);
});

test('ordena alfabéticamente el resultado', () => {
  const desordenadas = [act('AB_02'), act('AB_01'), act('AB_10')];

  assert.deepEqual(nombres(filtrarPorPrefijo(desordenadas, 'AB')), ['AB_01', 'AB_02', 'AB_10']);
});

test('ignora mayúsculas y espacios sobrantes', () => {
  const recolectadas = [act('  225252_mat1_u06_01  '), act('225252_MAT1_U07_01')];

  assert.deepEqual(nombres(filtrarPorPrefijo(recolectadas, ' 225252_MAT1_U06 ')), [
    '  225252_mat1_u06_01  ',
  ]);
});

test('un prefijo más largo no arrastra unidades vecinas', () => {
  // U06 no debe colar U06X ni U07, pero sí U06_*.
  const recolectadas = [act('X_U06_01'), act('X_U07_01'), act('X_U060_01')];

  assert.deepEqual(nombres(filtrarPorPrefijo(recolectadas, 'X_U06_')), ['X_U06_01']);
});

test('sin coincidencias devuelve lista vacía en lugar de todo', () => {
  assert.deepEqual(filtrarPorPrefijo([act('OTRO_01')], '225252_MAT1_U06'), []);
});

test('no muta la lista recibida', () => {
  const original = [act('B_01'), act('A_01')];
  filtrarPorPrefijo(original, '');

  assert.deepEqual(nombres(original), ['B_01', 'A_01']);
});
