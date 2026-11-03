import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CATALOG, CATALOG_DATE, PENDING_MEASURES } from '../src/catalog.js';
import {
  addProduct,
  buildBackup,
  correctMovement,
  createExampleState,
  createRealState,
  getLowStock,
  getTotals,
  moneyToCents,
  recordMovement,
  searchProducts,
  setProductArchived,
  updateProduct,
  validateBackup,
  validateState,
} from '../src/domain.js';

const NOW = '2026-11-03T12:00:00.000Z';
const LATER = '2026-11-03T12:01:00.000Z';
let sequence = 0;
const id = (prefix = 'event') => `${prefix}-${++sequence}`;

function emptyState() {
  return {
    schemaVersion: 1,
    mode: 'real',
    createdAt: NOW,
    updatedAt: NOW,
    lastBackupAt: null,
    products: [],
    history: [],
  };
}

function input(overrides = {}) {
  return {
    name: 'Producto de prueba',
    measure: '30 × 22 × 9',
    unitsPerPack: 5,
    minimum: 4,
    costCents: 1000,
    saleCents: 2000,
    packSaleCents: 9000,
    initialQuantity: 10,
    ...overrides,
  };
}

function oneProduct(overrides = {}) {
  return addProduct(emptyState(), input(overrides), NOW, 'product-1');
}

test('el catálogo real empieza en cero, sin precios actuales y conserva la procedencia', () => {
  const state = createRealState(NOW);
  assert.equal(state.products.length, BASE_CATALOG.length);
  assert.equal(state.history.length, 0);
  for (const product of state.products) {
    assert.equal(product.quantity, 0);
    assert.equal(product.costCents, null);
    assert.equal(product.saleCents, null);
    assert.equal(product.unitsPerPack, 1);
    assert.equal(product.reference.date, CATALOG_DATE);
    assert.equal(product.reference.date, '09/2026');
    assert.match(product.reference.file, /octubre/);
  }
  assert.equal(state.products.filter((product) => product.id === 'catalog-caja-30x22x9').length, 1);
  assert.equal(PENDING_MEASURES.length, 3);
  assert.match(PENDING_MEASURES[0].note, /Confirmar/);
  assert.equal(validateState(state), true);
});

test('los importes se guardan en centavos y los campos vacíos quedan sin cargar', () => {
  assert.equal(moneyToCents('150'), 15000);
  assert.equal(moneyToCents('150,50'), 15050);
  assert.equal(moneyToCents('0.05'), 5);
  assert.equal(moneyToCents(''), null);
  assert.ok(Number.isNaN(moneyToCents('1.234,56')));
  assert.ok(Number.isNaN(moneyToCents('-10')));
  assert.ok(Number.isNaN(moneyToCents('12,345')));
});

test('entradas y salidas usan un solo stock en unidades y convierten paquetes', () => {
  let state = oneProduct();
  state = recordMovement(state, { productId: 'product-1', direction: 'entry', mode: 'pack', quantity: 2 }, LATER, id());
  assert.equal(state.products[0].quantity, 20);
  assert.equal(state.history.at(-1).delta, 10);
  assert.equal(state.history.at(-1).inputQuantity, 2);
  assert.equal(state.history.at(-1).unitsPerPack, 5);
  state = recordMovement(state, { productId: 'product-1', direction: 'exit', mode: 'unit', quantity: 3 }, LATER, id());
  assert.equal(state.products[0].quantity, 17);
  assert.equal(state.history.at(-1).delta, -3);
});

test('rechaza cantidades inválidas y desbordes sin alterar el estado', () => {
  const state = oneProduct();
  const before = structuredClone(state);
  const invalid = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER];
  for (const quantity of invalid) {
    assert.throws(() => recordMovement(state, { productId: 'product-1', direction: 'entry', mode: 'pack', quantity }, LATER, id()));
  }
  assert.throws(() => recordMovement(state, { productId: 'product-1', direction: 'entry', mode: 'other', quantity: 1 }, LATER, id()));
  assert.deepEqual(state, before);
});

test('impide stock negativo sin guardar el movimiento', () => {
  const state = oneProduct();
  assert.throws(() => recordMovement(state, { productId: 'product-1', direction: 'exit', mode: 'pack', quantity: 3 }, LATER, id()), /stock|cantidad/i);
  assert.equal(state.products[0].quantity, 10);
  assert.equal(state.history.filter((event) => event.type === 'exit').length, 0);
});

test('marca valoraciones incompletas si falta un precio en productos con stock', () => {
  let state = oneProduct({ costCents: null, saleCents: null });
  let totals = getTotals(state);
  assert.equal(totals.missingCost, 1);
  assert.equal(totals.missingSale, 1);
  assert.equal(totals.costCents, 0);
  state = updateProduct(state, 'product-1', input({ costCents: 1250, saleCents: 2500, packSaleCents: 999999 }), LATER, id());
  totals = getTotals(state);
  assert.equal(totals.missingCost, 0);
  assert.equal(totals.missingSale, 0);
  assert.equal(totals.costCents, 12500);
  assert.equal(totals.saleCents, 25000, 'el precio opcional del paquete no altera la estimación por unidad');
});

test('un precio faltante con stock cero no vuelve incompleta una valoración de cero', () => {
  const state = oneProduct({ initialQuantity: 0, costCents: null, saleCents: null });
  assert.deepEqual(getTotals(state), { costCents: 0, saleCents: 0, missingCost: 0, missingSale: 0 });
});

test('señala mínimos solo en activos y conserva stock archivado en las valoraciones', () => {
  let state = oneProduct({ initialQuantity: 4, minimum: 4 });
  assert.equal(getLowStock(state).length, 1);
  state = setProductArchived(state, 'product-1', true, LATER, id());
  assert.equal(getLowStock(state).length, 0);
  assert.equal(getTotals(state).costCents, 4000);
  assert.throws(() => recordMovement(state, { productId: 'product-1', direction: 'entry', mode: 'unit', quantity: 1 }, LATER, id()));
});

test('busca por nombre o medida sin distinguir tildes ni el signo de multiplicación', () => {
  const state = oneProduct({ name: 'Caja café', measure: '30 × 22 × 9' });
  assert.equal(searchProducts(state.products, 'cafe').length, 1);
  assert.equal(searchProducts(state.products, '30x22').length, 1);
  assert.equal(searchProducts(state.products, '30 x 22').length, 1);
  assert.equal(searchProducts(state.products, 'otra cosa').length, 0);
});

test('ediciones posteriores no alteran nombre, paquete ni precios del historial', () => {
  let state = oneProduct({ initialQuantity: 20, unitsPerPack: 10, costCents: 100, saleCents: 200 });
  state = recordMovement(state, { productId: 'product-1', direction: 'entry', mode: 'pack', quantity: 1 }, LATER, id());
  const historical = structuredClone(state.history.at(-1));
  state = updateProduct(state, 'product-1', input({ name: 'Nombre nuevo', measure: '10 × 10', unitsPerPack: 20, costCents: 999, saleCents: 888 }), LATER, id());
  const preserved = state.history.find((event) => event.id === historical.id);
  assert.deepEqual(preserved, historical);
  assert.equal(preserved.productName, 'Producto de prueba');
  assert.equal(preserved.unitsPerPack, 10);
  assert.equal(preserved.costCents, 100);
  assert.equal(preserved.saleCents, 200);
  assert.equal(state.products[0].name, 'Nombre nuevo');
});

test('las correcciones agregan un registro identificado y no reescriben el original', () => {
  let state = oneProduct({ initialQuantity: 20 });
  state = recordMovement(state, { productId: 'product-1', direction: 'exit', mode: 'unit', quantity: 5 }, LATER, id());
  const original = structuredClone(state.history.at(-1));
  state = correctMovement(state, original.id, 3, 'Conté mal las unidades', LATER, id('correction'));
  const correction = state.history.at(-1);
  assert.equal(state.products[0].quantity, 17);
  assert.equal(correction.type, 'correction');
  assert.equal(correction.delta, 2);
  assert.equal(correction.correctsId, original.id);
  assert.equal(correction.reason, 'Conté mal las unidades');
  assert.deepEqual(state.history.find((event) => event.id === original.id), original);
});

test('una corrección tampoco puede dejar stock negativo', () => {
  let state = oneProduct({ initialQuantity: 5 });
  state = recordMovement(state, { productId: 'product-1', direction: 'exit', mode: 'unit', quantity: 5 }, LATER, id());
  const original = state.history.at(-1);
  assert.throws(() => correctMovement(state, original.id, 10, 'Error de prueba', LATER, id()));
  assert.equal(state.products[0].quantity, 0);
});

test('archivar y desarchivar conserva todo el historial', () => {
  let state = oneProduct();
  const history = structuredClone(state.history);
  state = setProductArchived(state, 'product-1', true, LATER, id());
  state = setProductArchived(state, 'product-1', false, LATER, id());
  for (const event of history) assert.deepEqual(state.history.find((item) => item.id === event.id), event);
  assert.equal(state.products[0].archived, false);
});

test('una edición sin cambios no crea historial redundante', () => {
  const state = oneProduct();
  const unchanged = updateProduct(state, 'product-1', input(), LATER, id());
  assert.equal(unchanged, state);
});

test('la exportación y recuperación conserva productos, precios, stock e historial', () => {
  let state = oneProduct();
  state = recordMovement(state, { productId: 'product-1', direction: 'entry', mode: 'pack', quantity: 1 }, LATER, id());
  state.lastBackupAt = LATER;
  const backup = buildBackup(state, LATER);
  const restored = validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(restored, state);
  assert.notEqual(restored, state);
});

test('rechaza respaldos incompatibles o internamente inconsistentes', () => {
  const backup = buildBackup(oneProduct(), LATER);
  assert.throws(() => validateBackup({ ...backup, app: 'Otra app' }), /compatible/);
  const negative = structuredClone(backup);
  negative.data.products[0].quantity = -1;
  assert.throws(() => validateBackup(negative));
  const inconsistent = structuredClone(backup);
  const initial = inconsistent.data.history.find((event) => event.type === 'initial');
  initial.afterStock += 1;
  assert.throws(() => validateBackup(inconsistent), /inconsistente/);
  const missingProduct = structuredClone(backup);
  missingProduct.data.history[0].productId = 'inexistente';
  assert.throws(() => validateBackup(missingProduct), /inexistente/);
});

test('salir del ejemplo puede crear un estado real independiente y sin mezcla', () => {
  const example = createExampleState(NOW);
  assert.equal(example.mode, 'example');
  assert.ok(example.products.every((product) => product.id.startsWith('example-')));
  const real = createRealState(LATER);
  assert.equal(real.mode, 'real');
  assert.equal(real.products.some((product) => product.id.startsWith('example-')), false);
  assert.equal(real.history.length, 0);
  assert.ok(real.products.every((product) => product.quantity === 0 && product.costCents === null));
});
