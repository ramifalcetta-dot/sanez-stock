import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addProduct,
  buildBackup,
  correctMovement,
  recordMovement,
  validateBackup,
} from '../src/domain.js';

const NOW = '2026-11-03T12:00:00.000Z';
let sequence = 0;
const id = () => `regression-${++sequence}`;

function stateWithProduct(initialQuantity = 20) {
  const state = {
    schemaVersion: 1,
    mode: 'real',
    createdAt: NOW,
    updatedAt: NOW,
    lastBackupAt: null,
    products: [],
    history: [],
  };
  return addProduct(state, {
    name: 'Producto con datos previos',
    measure: '10 × 20',
    unitsPerPack: 5,
    minimum: 2,
    costCents: 1234,
    saleCents: 2345,
    packSaleCents: 10000,
    initialQuantity,
  }, NOW, 'product-existing');
}

test('una segunda corrección sobre el mismo movimiento usa su efecto vigente', () => {
  let state = stateWithProduct(20);
  state = recordMovement(state, { productId: 'product-existing', direction: 'exit', mode: 'unit', quantity: 5 }, NOW, id());
  const originalId = state.history.at(-1).id;
  state = correctMovement(state, originalId, 3, 'Primera corrección', NOW, id());
  assert.equal(state.products[0].quantity, 17);
  const beforeSecondCorrection = structuredClone(state.history);
  state = correctMovement(state, originalId, 4, 'Segunda corrección', NOW, id());
  assert.equal(state.products[0].quantity, 16);
  assert.equal(state.history.at(-1).delta, -1);
  assert.deepEqual(state.history.slice(0, -1), beforeSecondCorrection);
  assert.equal(validateBackup(buildBackup(state, NOW)).products[0].quantity, 16);
});

test('la recuperación rechaza un stock que no coincide con el saldo final del historial', () => {
  let state = stateWithProduct(20);
  state = recordMovement(state, { productId: 'product-existing', direction: 'entry', mode: 'unit', quantity: 1 }, NOW, id());
  assert.equal(state.products[0].quantity, 21);
  const backup = buildBackup(state, NOW);
  backup.data.products[0].quantity = 999;
  assert.throws(() => validateBackup(backup), /saldo|stock|coincide/i);
});

test('la recuperación valida el signo de entradas y salidas', () => {
  let state = stateWithProduct(20);
  state = recordMovement(state, { productId: 'product-existing', direction: 'entry', mode: 'unit', quantity: 1 }, NOW, id());
  const backup = buildBackup(state, NOW);
  const entry = backup.data.history.at(-1);
  entry.delta = -1;
  entry.afterStock = 19;
  backup.data.products[0].quantity = 19;
  assert.throws(() => validateBackup(backup), /signo|entrada|salida/i);
});

test('una corrección debe apuntar a un movimiento de stock anterior', () => {
  let state = stateWithProduct(20);
  state = correctMovement(state, 'product-existing:initial', 18, 'Ajuste de prueba', NOW, id());
  const backup = buildBackup(state, NOW);
  backup.data.history.at(-1).correctsId = 'product-existing:created';
  assert.throws(() => validateBackup(backup), /correcci[oó]n|movimiento|stock/i);
});

test('las correcciones repetidas de la versión anterior se conservan y la siguiente usa el efecto vigente', () => {
  let state = stateWithProduct(20);
  state = recordMovement(state, { productId: 'product-existing', direction: 'exit', mode: 'unit', quantity: 5 }, NOW, id());
  const originalId = state.history.at(-1).id;
  state = correctMovement(state, originalId, 3, 'Primera corrección', NOW, id());
  state.products[0].quantity = 18;
  state.history.push({
    ...state.history.at(-1),
    id: id(),
    delta: 1,
    beforeStock: 17,
    afterStock: 18,
    inputQuantity: 1,
    correctedQuantity: 4,
    reason: 'Segunda corrección histórica de la versión anterior',
  });
  const previousHistory = structuredClone(state.history);
  assert.equal(validateBackup(buildBackup(state, NOW)).products[0].quantity, 18);
  state = correctMovement(state, originalId, 5, 'Corrección posterior a la actualización', NOW, id());
  assert.equal(state.products[0].quantity, 16);
  assert.equal(state.history.at(-1).delta, -2);
  assert.deepEqual(state.history.slice(0, -1), previousHistory);
});
