import { BASE_CATALOG } from './catalog.js';

export const STATE_VERSION = 1;
export const BACKUP_FORMAT = 1;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const STOCK_EVENT_TYPES = new Set(['initial', 'entry', 'exit', 'correction']);

const clone = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInteger = (value) => Number.isSafeInteger(value);

function requireInteger(value, minimum, label) {
  if (!isInteger(value) || value < minimum) fail(`${label} debe ser un entero mayor o igual a ${minimum}.`);
  return value;
}

function requireString(value, label, maximum = 200, allowEmpty = false) {
  if (typeof value !== 'string') fail(`${label} no es válido.`);
  const clean = value.trim();
  if (!allowEmpty && !clean) fail(`${label} no puede estar vacío.`);
  if (clean.length > maximum) fail(`${label} supera el máximo de ${maximum} caracteres.`);
  return clean;
}

function requireDate(value, label = 'La fecha') {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(`${label} no es válida.`);
  return value;
}

function requirePrice(value, label) {
  if (value === null) return null;
  return requireInteger(value, 0, label);
}

export function moneyToCents(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return Number.NaN;
  const [whole, fraction = ''] = text.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return isInteger(cents) ? cents : Number.NaN;
}

function normalizeProductInput(input) {
  if (!isObject(input)) fail('Los datos del producto no son válidos.');
  return {
    name: requireString(input.name, 'El nombre', 90),
    measure: requireString(input.measure ?? '', 'La medida', 60, true),
    unitsPerPack: requireInteger(input.unitsPerPack, 1, 'Las unidades por paquete'),
    minimum: requireInteger(input.minimum, 0, 'El mínimo'),
    costCents: requirePrice(input.costCents, 'El precio de compra'),
    saleCents: requirePrice(input.saleCents, 'El precio de venta'),
    packSaleCents: requirePrice(input.packSaleCents, 'El precio por paquete'),
  };
}

function baseState(mode, now) {
  return {
    schemaVersion: STATE_VERSION,
    mode,
    createdAt: now,
    updatedAt: now,
    lastBackupAt: null,
    products: [],
    history: [],
  };
}

export function createRealState(now = new Date().toISOString()) {
  requireDate(now);
  const state = baseState('real', now);
  state.products = BASE_CATALOG.map((item) => ({
    ...clone(item),
    createdAt: now,
    updatedAt: now,
  }));
  return state;
}

export function createExampleState(now = new Date().toISOString()) {
  requireDate(now);
  const state = baseState('example', now);
  const examples = [
    { id: 'example-vaso', name: 'Vaso de ejemplo · 240 cc', measure: '', unitsPerPack: 100, minimum: 100, quantity: 350, costCents: 10000, saleCents: 16000, packSaleCents: 1500000 },
    { id: 'example-frappe', name: 'Vaso frappé de ejemplo · 500 cc', measure: '', unitsPerPack: 100, minimum: 100, quantity: 80, costCents: 23000, saleCents: 38000, packSaleCents: 3600000 },
    { id: 'example-caja', name: 'Caja autoarmable de ejemplo', measure: '30 × 22 × 9', unitsPerPack: 25, minimum: 25, quantity: 125, costCents: 60000, saleCents: 100000, packSaleCents: 2400000 },
    { id: 'example-ensaladera', name: 'Ensaladera de ejemplo · 50 oz', measure: '', unitsPerPack: 25, minimum: 50, quantity: 40, costCents: 50000, saleCents: 80000, packSaleCents: 1900000 },
  ];
  state.products = examples.map((item) => ({
    ...item,
    archived: false,
    reference: null,
    createdAt: now,
    updatedAt: now,
  }));
  state.history = examples.map((item, index) => ({
    id: `example-initial-${index + 1}`,
    type: 'initial',
    productId: item.id,
    productName: item.name,
    measure: item.measure,
    at: now,
    delta: item.quantity,
    beforeStock: 0,
    afterStock: item.quantity,
    inputMode: 'unit',
    inputQuantity: item.quantity,
    unitsPerPack: item.unitsPerPack,
    costCents: item.costCents,
    saleCents: item.saleCents,
    packSaleCents: item.packSaleCents,
  }));
  return state;
}

function findProduct(state, productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) fail('No se encontró el producto.');
  return product;
}

function snapshot(product) {
  return {
    productId: product.id,
    productName: product.name,
    measure: product.measure,
    unitsPerPack: product.unitsPerPack,
    costCents: product.costCents,
    saleCents: product.saleCents,
    packSaleCents: product.packSaleCents,
  };
}

function finish(state, now) {
  state.updatedAt = now;
  return state;
}

export function addProduct(state, input, now, id) {
  requireDate(now);
  requireString(id, 'El identificador', 100);
  if (state.products.some((item) => item.id === id)) fail('Ya existe un producto con ese identificador.');
  const fields = normalizeProductInput(input);
  const initialQuantity = requireInteger(input.initialQuantity ?? 0, 0, 'El stock inicial');
  const next = clone(state);
  const product = {
    id,
    ...fields,
    quantity: initialQuantity,
    archived: false,
    reference: null,
    createdAt: now,
    updatedAt: now,
  };
  next.products.push(product);
  next.history.push({
    id: `${id}:created`,
    type: 'product',
    productId: id,
    productName: product.name,
    measure: product.measure,
    at: now,
  });
  if (initialQuantity > 0) {
    next.history.push({
      id: `${id}:initial`,
      type: 'initial',
      ...snapshot(product),
      at: now,
      delta: initialQuantity,
      beforeStock: 0,
      afterStock: initialQuantity,
      inputMode: 'unit',
      inputQuantity: initialQuantity,
    });
  }
  return finish(next, now);
}

export function updateProduct(state, productId, input, now, eventId) {
  requireDate(now);
  requireString(eventId, 'El identificador del registro', 120);
  const fields = normalizeProductInput(input);
  const next = clone(state);
  const product = findProduct(next, productId);
  const changes = {};
  for (const key of Object.keys(fields)) {
    if (product[key] !== fields[key]) changes[key] = { before: product[key], after: fields[key] };
  }
  if (!Object.keys(changes).length) return state;
  Object.assign(product, fields, { updatedAt: now });
  next.history.push({
    id: eventId,
    type: 'product-edit',
    productId,
    productName: product.name,
    measure: product.measure,
    at: now,
    changes,
  });
  return finish(next, now);
}

export function setProductArchived(state, productId, archived, now, eventId) {
  requireDate(now);
  if (typeof archived !== 'boolean') fail('El estado de archivo no es válido.');
  const next = clone(state);
  const product = findProduct(next, productId);
  if (product.archived === archived) return state;
  product.archived = archived;
  product.updatedAt = now;
  next.history.push({
    id: eventId,
    type: archived ? 'archive' : 'unarchive',
    productId,
    productName: product.name,
    measure: product.measure,
    at: now,
  });
  return finish(next, now);
}

export function recordMovement(state, input, now, eventId) {
  requireDate(now);
  requireString(eventId, 'El identificador del registro', 120);
  const direction = input.direction;
  if (!['entry', 'exit'].includes(direction)) fail('El tipo de movimiento no es válido.');
  if (!['unit', 'pack'].includes(input.mode)) fail('El modo de cantidad no es válido.');
  const quantity = requireInteger(input.quantity, 1, 'La cantidad');
  const next = clone(state);
  const product = findProduct(next, input.productId);
  if (product.archived) fail('No se puede mover un producto archivado.');
  const units = quantity * (input.mode === 'pack' ? product.unitsPerPack : 1);
  requireInteger(units, 1, 'El total de unidades');
  const delta = direction === 'entry' ? units : -units;
  const afterStock = product.quantity + delta;
  requireInteger(afterStock, 0, 'El stock resultante');
  if (afterStock < 0) fail('No tenés esa cantidad disponible.');
  const beforeStock = product.quantity;
  product.quantity = afterStock;
  product.updatedAt = now;
  next.history.push({
    id: eventId,
    type: direction,
    ...snapshot(product),
    at: now,
    delta,
    beforeStock,
    afterStock,
    inputMode: input.mode,
    inputQuantity: quantity,
  });
  return finish(next, now);
}

function getEffectiveDeltas(history) {
  const effectiveDeltas = new Map();
  const events = new Map();
  for (const event of history) {
    if (!STOCK_EVENT_TYPES.has(event.type)) continue;
    let effectiveDelta = event.delta;
    if (event.type === 'correction') {
      const original = events.get(event.correctsId);
      const baseDelta = effectiveDeltas.get(event.correctsId);
      if (!original || baseDelta === undefined) fail('Una corrección no apunta a un movimiento de stock anterior.');
      const correctedDelta = (baseDelta < 0 ? -1 : 1) * event.correctedQuantity;
      effectiveDelta = correctedDelta - baseDelta;
      const legacyDelta = correctedDelta - original.delta;
      if (event.delta === legacyDelta && event.delta !== effectiveDelta) effectiveDelta = event.delta;
      else effectiveDeltas.set(event.correctsId, correctedDelta);
    }
    effectiveDeltas.set(event.id, effectiveDelta);
    events.set(event.id, event);
  }
  return effectiveDeltas;
}

export function correctMovement(state, movementId, correctedQuantity, reason, now, eventId) {
  requireDate(now);
  requireString(eventId, 'El identificador del registro', 120);
  requireInteger(correctedQuantity, 1, 'La cantidad corregida');
  const cleanReason = requireString(reason, 'El motivo', 200);
  const next = clone(state);
  const original = next.history.find((item) => item.id === movementId);
  if (!original || !STOCK_EVENT_TYPES.has(original.type)) fail('El registro no admite una corrección de cantidad.');
  const product = findProduct(next, original.productId);
  const effectiveDeltas = getEffectiveDeltas(next.history);
  const baseDelta = effectiveDeltas.get(original.id);
  const correctedDelta = (baseDelta < 0 ? -1 : 1) * correctedQuantity;
  const adjustment = correctedDelta - baseDelta;
  if (adjustment === 0) fail('La cantidad corregida es igual a la original.');
  const afterStock = product.quantity + adjustment;
  requireInteger(afterStock, 0, 'El stock resultante');
  if (afterStock < 0) fail('La corrección dejaría el stock en negativo.');
  product.quantity = afterStock;
  product.updatedAt = now;
  next.history.push({
    id: eventId,
    type: 'correction',
    ...snapshot(product),
    at: now,
    delta: adjustment,
    beforeStock: afterStock - adjustment,
    afterStock,
    inputMode: 'unit',
    inputQuantity: Math.abs(adjustment),
    correctsId: original.id,
    correctedQuantity,
    reason: cleanReason,
  });
  return finish(next, now);
}

export function getTotals(state) {
  const result = {
    costCents: 0,
    saleCents: 0,
    missingCost: 0,
    missingSale: 0,
  };
  for (const product of state.products) {
    if (product.quantity === 0) continue;
    if (product.costCents === null) result.missingCost += 1;
    else result.costCents += product.quantity * product.costCents;
    if (product.saleCents === null) result.missingSale += 1;
    else result.saleCents += product.quantity * product.saleCents;
  }
  requireInteger(result.costCents, 0, 'La valoración al costo');
  requireInteger(result.saleCents, 0, 'La valoración de venta');
  return result;
}

export function getLowStock(state) {
  return state.products.filter((product) => !product.archived && product.quantity <= product.minimum);
}

export function normalizeSearch(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[×✕]/g, 'x')
    .replace(/\s*x\s*/g, 'x')
    .toLocaleLowerCase('es')
    .trim();
}

export function searchProducts(products, term, includeArchived = false) {
  const query = normalizeSearch(term);
  return products.filter((product) => {
    if (!includeArchived && product.archived) return false;
    if (includeArchived && !product.archived) return false;
    return !query || normalizeSearch(`${product.name} ${product.measure}`).includes(query);
  });
}

function validateReference(reference) {
  if (reference === null) return;
  if (!isObject(reference)) fail('La referencia del catálogo no es válida.');
  requireString(reference.date, 'La fecha de referencia', 30);
  requireString(reference.file, 'El archivo de referencia', 150);
  if (!Array.isArray(reference.offers) || reference.offers.length > 100) fail('Las referencias de precio no son válidas.');
  for (const offer of reference.offers) {
    if (!isObject(offer)) fail('Una referencia de precio no es válida.');
    requireString(offer.label, 'La cantidad de referencia', 60);
    requirePrice(offer.priceCents, 'El precio de referencia');
    requirePrice(offer.unitPriceCents, 'El precio unitario de referencia');
    if (offer.priceCents === null && offer.unitPriceCents === null) fail('La referencia no tiene precio.');
  }
}

function validateProduct(product) {
  if (!isObject(product)) fail('Hay un producto inválido.');
  requireString(product.id, 'El identificador del producto', 100);
  normalizeProductInput(product);
  requireInteger(product.quantity, 0, 'El stock');
  if (typeof product.archived !== 'boolean') fail('El estado de archivo no es válido.');
  requireDate(product.createdAt, 'La fecha de creación');
  requireDate(product.updatedAt, 'La fecha de actualización');
  validateReference(product.reference);
}

function validateHistoryEvent(event) {
  if (!isObject(event)) fail('Hay un registro de historial inválido.');
  requireString(event.id, 'El identificador del registro', 120);
  requireString(event.productId, 'El producto del registro', 100);
  requireString(event.productName, 'El nombre histórico', 90);
  requireString(event.measure ?? '', 'La medida histórica', 60, true);
  requireDate(event.at, 'La fecha del registro');
  if (!['product', 'product-edit', 'archive', 'unarchive', ...STOCK_EVENT_TYPES].includes(event.type)) {
    fail('El tipo de registro no es válido.');
  }
  if (event.type === 'product-edit' && !isObject(event.changes)) fail('Los cambios del registro no son válidos.');
  if (!STOCK_EVENT_TYPES.has(event.type)) return;
  if (!isInteger(event.delta) || event.delta === 0) fail('La cantidad del registro no es válida.');
  requireInteger(event.beforeStock, 0, 'El stock anterior del registro');
  requireInteger(event.afterStock, 0, 'El stock posterior del registro');
  if (event.beforeStock + event.delta !== event.afterStock) fail('El registro tiene un cálculo inconsistente.');
  if (!['unit', 'pack'].includes(event.inputMode)) fail('El modo del registro no es válido.');
  requireInteger(event.inputQuantity, 1, 'La cantidad ingresada del registro');
  requireInteger(event.unitsPerPack, 1, 'El paquete histórico');
  requirePrice(event.costCents, 'El costo histórico');
  requirePrice(event.saleCents, 'La venta histórica');
  requirePrice(event.packSaleCents, 'El precio de paquete histórico');
  if (event.type === 'correction') {
    requireString(event.correctsId, 'La referencia de corrección', 120);
    requireInteger(event.correctedQuantity, 1, 'La cantidad corregida del registro');
    requireString(event.reason, 'El motivo de corrección', 200);
  }
}

export function validateState(state) {
  if (!isObject(state) || state.schemaVersion !== STATE_VERSION) fail('La versión de los datos no es compatible.');
  if (!['real', 'example'].includes(state.mode)) fail('El modo de los datos no es válido.');
  requireDate(state.createdAt, 'La fecha de creación');
  requireDate(state.updatedAt, 'La fecha de actualización');
  if (state.lastBackupAt !== null) requireDate(state.lastBackupAt, 'La fecha del respaldo');
  if (!Array.isArray(state.products) || state.products.length > 10000) fail('La lista de productos no es válida.');
  if (!Array.isArray(state.history) || state.history.length > 100000) fail('El historial no es válido.');
  const productIds = new Set();
  for (const product of state.products) {
    validateProduct(product);
    if (productIds.has(product.id)) fail('Hay productos con identificadores repetidos.');
    productIds.add(product.id);
  }
  const eventIds = new Set();
  for (const event of state.history) {
    validateHistoryEvent(event);
    if (eventIds.has(event.id)) fail('Hay registros con identificadores repetidos.');
    if (!productIds.has(event.productId)) fail('El historial apunta a un producto inexistente.');
    eventIds.add(event.id);
  }
  const balances = new Map(state.products.map((product) => [product.id, 0]));
  const stockEvents = new Map();
  for (const event of state.history) {
    if (!STOCK_EVENT_TYPES.has(event.type)) continue;
    if (['initial', 'entry'].includes(event.type) && event.delta < 0) fail('Una entrada tiene el signo incorrecto.');
    if (event.type === 'exit' && event.delta > 0) fail('Una salida tiene el signo incorrecto.');
    const balance = balances.get(event.productId);
    if (event.beforeStock !== balance) fail('El stock anterior de un registro no coincide con el saldo histórico.');
    if (event.type === 'correction') {
      const original = stockEvents.get(event.correctsId);
      if (!original || original.productId !== event.productId) fail('Una corrección debe apuntar a un movimiento de stock anterior del mismo producto.');
    }
    stockEvents.set(event.id, event);
    balances.set(event.productId, event.afterStock);
  }
  for (const product of state.products) {
    if (product.quantity !== balances.get(product.id)) fail('El stock del producto no coincide con el saldo final del historial.');
  }
  return true;
}

export function buildBackup(state, exportedAt = new Date().toISOString()) {
  requireDate(exportedAt, 'La fecha de exportación');
  validateState(state);
  return {
    app: 'Sánez Stock',
    formatVersion: BACKUP_FORMAT,
    exportedAt,
    data: clone(state),
  };
}

export function validateBackup(backup) {
  if (!isObject(backup) || backup.app !== 'Sánez Stock' || backup.formatVersion !== BACKUP_FORMAT) {
    fail('El archivo no es una copia compatible de Sánez Stock.');
  }
  requireDate(backup.exportedAt, 'La fecha de exportación');
  validateState(backup.data);
  return clone(backup.data);
}
