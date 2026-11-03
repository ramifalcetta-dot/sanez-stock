import { loadState, saveState } from './db.js';
import { PENDING_MEASURES } from './catalog.js';
import {
  MAX_BACKUP_BYTES,
  STOCK_EVENT_TYPES,
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
} from './domain.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const moneyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const formatMoney = (cents) => cents === null || cents === undefined ? 'Sin cargar' : moneyFormatter.format(cents / 100);
const formatNumber = (value) => numberFormatter.format(value);
const formatDate = (value) => dateFormatter.format(new Date(value));
const centsToInput = (cents) => cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
const newId = () => crypto.randomUUID();

let state = null;
let currentView = 'welcome';
let direction = 'entry';
let editingId = null;
let correctionId = null;
let includeArchived = false;
let message = '';
let busy = false;

function setSaveStatus(text) {
  $('[data-save-status]').textContent = text;
}

function showGlobalError(text) {
  const element = $('[data-global-error]');
  element.textContent = text;
  element.hidden = !text;
}

function showView(view) {
  currentView = view;
  message = '';
  showGlobalError('');
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function commit(nextState, successMessage, targetView = 'home') {
  if (busy) return false;
  busy = true;
  showGlobalError('');
  setSaveStatus('Guardando…');
  try {
    validateState(nextState);
    await saveState(nextState);
    state = nextState;
    message = successMessage;
    currentView = targetView;
    includeArchived = false;
    render();
    setSaveStatus('Guardado en este dispositivo');
    window.scrollTo({ top: 0, behavior: 'instant' });
    return true;
  } catch (error) {
    console.error(error);
    showGlobalError(`No se pudo guardar el cambio: ${error.message}. Revisá el espacio disponible y volvé a intentar.`);
    setSaveStatus('Cambio sin guardar');
    return false;
  } finally {
    busy = false;
  }
}

function render() {
  const hasState = state !== null;
  $('[data-demo]').hidden = !hasState || state.mode !== 'example';
  $('[data-tabs]').hidden = !hasState;
  $$('[data-view]').forEach((section) => { section.hidden = section.dataset.view !== currentView; });
  const messageElement = $('[data-message]');
  messageElement.textContent = message;
  messageElement.hidden = !message;
  $$('[data-tab]').forEach((button) => {
    if (button.dataset.tab === currentView) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (!hasState) return;
  renderHome();
  renderHistory();
  renderBackup();
}

function renderTotals() {
  const totals = getTotals(state);
  const costAmount = $('[data-total-cost]');
  const saleAmount = $('[data-total-sale]');
  costAmount.textContent = totals.missingCost ? 'Incompleto' : formatMoney(totals.costCents);
  saleAmount.textContent = totals.missingSale ? 'Incompleto' : formatMoney(totals.saleCents);
  $('[data-total-cost-note]').textContent = totals.missingCost
    ? `Falta la compra en ${totals.missingCost} producto${totals.missingCost === 1 ? '' : 's'} con stock. Parcial conocido: ${formatMoney(totals.costCents)}.`
    : 'Según el precio de compra cargado';
  $('[data-total-sale-note]').textContent = totals.missingSale
    ? `Falta la venta en ${totals.missingSale} producto${totals.missingSale === 1 ? '' : 's'} con stock. Parcial: ${formatMoney(totals.saleCents)}. Estimado por unidad; no es dinero cobrado.`
    : 'Estimado por unidad · No es dinero cobrado';
}

function renderHome() {
  renderTotals();
  const low = getLowStock(state);
  $('[data-low]').textContent = low.length
    ? `${low.length} producto${low.length === 1 ? ' necesita' : 's necesitan'} reposición`
    : 'Todos los productos activos están por encima del mínimo';
  $('[data-products-title]').textContent = includeArchived ? 'Productos archivados' : 'Mis productos';
  $('[data-action="toggle-archived"]').textContent = includeArchived ? 'Volver a productos activos' : 'Ver productos archivados';
  const term = $('[data-search]').value;
  const products = searchProducts(state.products, term, includeArchived);
  $('[data-products]').innerHTML = products.map((product) => {
    const packs = Math.floor(product.quantity / product.unitsPerPack);
    const loose = product.quantity % product.unitsPerPack;
    const isLow = !product.archived && product.quantity <= product.minimum;
    return `<article class="product">
      <div class="product-title">${escapeHTML(product.name)}</div>
      ${product.measure ? `<div class="measure">Medida: ${escapeHTML(product.measure)}</div>` : ''}
      ${isLow ? '<div class="low-label">Stock bajo</div>' : ''}
      <div class="product-row"><div><div class="stock">${formatNumber(product.quantity)} unidades</div>
      <div class="note">${formatNumber(packs)} paq. de ${formatNumber(product.unitsPerPack)}${loose ? ` + ${formatNumber(loose)} sueltas` : ''}</div></div>
      <button type="button" data-edit="${escapeHTML(product.id)}">Editar</button></div>
      <div class="price-line">Compra: ${formatMoney(product.costCents)} · Venta: ${formatMoney(product.saleCents)}<br>Precios por unidad${product.packSaleCents !== null ? `<br>Venta por paquete: ${formatMoney(product.packSaleCents)}` : ''}</div>
    </article>`;
  }).join('') || `<p class="hint">${includeArchived ? 'No hay productos archivados para mostrar.' : 'No hay productos con ese nombre o medida.'}</p>`;
}

function showMove(nextDirection) {
  const products = state.products.filter((product) => !product.archived);
  if (!products.length) {
    message = 'Primero agregá o desarchivá un producto.';
    render();
    return;
  }
  direction = nextDirection;
  const form = $('[data-move-form]');
  $('[data-move-title]').textContent = direction === 'entry' ? 'Entró mercadería' : 'Salió mercadería';
  form.elements.product.innerHTML = products.map((product) => `<option value="${escapeHTML(product.id)}">${escapeHTML(product.name)}${product.measure ? ` · ${escapeHTML(product.measure)}` : ''}</option>`).join('');
  form.elements.quantity.value = 1;
  form.elements.mode.value = 'unit';
  $('[data-move-error]').hidden = true;
  showView('move');
  updateMovePreview();
}

function updateMovePreview() {
  const form = $('[data-move-form]');
  const product = state.products.find((item) => item.id === form.elements.product.value);
  if (!product) return;
  const quantity = Number(form.elements.quantity.value);
  const units = quantity * (form.elements.mode.value === 'pack' ? product.unitsPerPack : 1);
  const after = product.quantity + (direction === 'entry' ? units : -units);
  $('[data-current]').textContent = `Disponibles: ${formatNumber(product.quantity)} unidades. Paquetes de ${formatNumber(product.unitsPerPack)}.`;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(units) || !Number.isSafeInteger(after)) {
    $('[data-move-preview]').textContent = 'Ingresá una cantidad entera válida mayor que cero.';
  } else {
    $('[data-move-preview]').textContent = `${direction === 'entry' ? 'Sumás' : 'Descontás'} ${formatNumber(units)} unidades. ${after < 0 ? 'No alcanza el stock.' : `Quedarían ${formatNumber(after)} unidades.`}`;
  }
}

function referenceHTML(product) {
  if (!product?.reference) return '';
  const reference = product.reference;
  const offers = reference.offers.map((offer) => {
    const prices = [];
    if (offer.priceCents !== null) prices.push(formatMoney(offer.priceCents));
    if (offer.unitPriceCents !== null) prices.push(`${formatMoney(offer.unitPriceCents)} por unidad`);
    return `<li>${escapeHTML(offer.label)}: ${prices.join(' · ')}</li>`;
  }).join('');
  return `<strong>Referencia de lista Sánez ${escapeHTML(reference.date)}</strong><br>Archivo: ${escapeHTML(reference.file)}<ul>${offers}</ul>Las cantidades son opciones de venta del catálogo, no existencias ni unidades por paquete. No son costos de compra ni precios actuales confirmados.`;
}

function showEdit(productId) {
  editingId = productId;
  const product = state.products.find((item) => item.id === productId);
  const form = $('[data-edit-form]');
  $('[data-edit-title]').textContent = product ? 'Editar producto' : 'Agregar producto';
  const values = {
    name: product?.name ?? '',
    measure: product?.measure ?? '',
    pack: product?.unitsPerPack ?? 1,
    minimum: product?.minimum ?? 0,
    cost: centsToInput(product?.costCents ?? null),
    sale: centsToInput(product?.saleCents ?? null),
    packsale: centsToInput(product?.packSaleCents ?? null),
    initial: 0,
  };
  for (const [key, value] of Object.entries(values)) form.elements[key].value = value;
  $('[data-initial-wrap]').hidden = Boolean(product);
  form.elements.initial.required = !product;
  const reference = $('[data-reference]');
  reference.innerHTML = referenceHTML(product);
  reference.hidden = !product?.reference;
  const archiveButton = $('[data-action="archive"]');
  archiveButton.hidden = !product;
  archiveButton.textContent = product?.archived ? 'Desarchivar producto' : 'Archivar producto';
  $('[data-edit-error]').hidden = true;
  showView('edit');
}

function productInputFromForm() {
  const form = $('[data-edit-form]');
  return {
    name: form.elements.name.value,
    measure: form.elements.measure.value,
    unitsPerPack: Number(form.elements.pack.value),
    minimum: Number(form.elements.minimum.value),
    costCents: moneyToCents(form.elements.cost.value),
    saleCents: moneyToCents(form.elements.sale.value),
    packSaleCents: moneyToCents(form.elements.packsale.value),
    initialQuantity: Number(form.elements.initial.value),
  };
}

function describeChanges(changes) {
  const labels = {
    name: 'Nombre', measure: 'Medida', unitsPerPack: 'Unidades por paquete', minimum: 'Mínimo',
    costCents: 'Compra', saleCents: 'Venta', packSaleCents: 'Venta por paquete',
  };
  return Object.entries(changes).map(([key, change]) => {
    const isPrice = key.endsWith('Cents');
    const before = isPrice ? formatMoney(change.before) : (change.before ?? 'Sin cargar');
    const after = isPrice ? formatMoney(change.after) : (change.after ?? 'Sin cargar');
    return `${labels[key] ?? key}: ${before} → ${after}`;
  }).join(' · ');
}

function historyDescription(event) {
  const sign = event.delta > 0 ? '+' : '−';
  const amount = `${sign}${formatNumber(Math.abs(event.delta))} unidades`;
  if (event.type === 'entry') return `Entrada · ${amount}`;
  if (event.type === 'exit') return `Salida · ${amount}`;
  if (event.type === 'initial') return `Stock inicial · ${amount}`;
  if (event.type === 'correction') return `Corrección · ${amount}`;
  if (event.type === 'product') return 'Producto agregado';
  if (event.type === 'product-edit') return 'Datos actualizados';
  if (event.type === 'archive') return 'Producto archivado';
  if (event.type === 'unarchive') return 'Producto desarchivado';
  return 'Registro';
}

function renderHistory() {
  const corrections = new Set(state.history.filter((event) => event.type === 'correction').map((event) => event.correctsId));
  $('[data-history]').innerHTML = [...state.history].reverse().map((event) => {
    const stockDetails = STOCK_EVENT_TYPES.has(event.type)
      ? `<div class="history-detail">Stock: ${formatNumber(event.beforeStock)} → ${formatNumber(event.afterStock)} unidades${event.inputMode === 'pack' ? `<br>Ingresado: ${formatNumber(event.inputQuantity)} paq. de ${formatNumber(event.unitsPerPack)}` : ''}<br>Precios al registrar · Compra: ${formatMoney(event.costCents)} · Venta: ${formatMoney(event.saleCents)}</div>`
      : '';
    const correctionDetails = event.type === 'correction'
      ? `<div class="history-detail">Cantidad original corregida a ${formatNumber(event.correctedQuantity)} unidades.<br>Motivo: ${escapeHTML(event.reason)}<br>Corrige el registro ${escapeHTML(event.correctsId)}</div>`
      : '';
    const editDetails = event.type === 'product-edit' ? `<div class="history-detail">${escapeHTML(describeChanges(event.changes))}</div>` : '';
    return `<article class="history-event">
      <div class="history-top"><div class="history-type">${historyDescription(event)}</div><div class="history-date">${formatDate(event.at)}</div></div>
      <div class="history-product">${escapeHTML(event.productName)}${event.measure ? ` · ${escapeHTML(event.measure)}` : ''}</div>
      ${stockDetails}${correctionDetails}${editDetails}
      ${corrections.has(event.id) ? '<span class="correction-label">Tiene una corrección posterior</span>' : ''}
      ${STOCK_EVENT_TYPES.has(event.type) ? `<button type="button" data-correct="${escapeHTML(event.id)}">Corregir cantidad</button>` : ''}
    </article>`;
  }).join('') || '<p class="hint">Todavía no hay movimientos.</p>';
}

function showCorrection(eventId) {
  const event = state.history.find((item) => item.id === eventId);
  if (!event || !STOCK_EVENT_TYPES.has(event.type)) return;
  correctionId = eventId;
  $('[data-correction-original]').textContent = `${historyDescription(event)} · ${event.productName}. Stock en ese registro: ${event.beforeStock} → ${event.afterStock}.`;
  const form = $('[data-correction-form]');
  form.elements.corrected.value = Math.abs(event.delta);
  form.elements.reason.value = '';
  $('[data-correction-error]').hidden = true;
  showView('correction');
}

function renderBackup() {
  $('[data-last-backup]').textContent = state.lastBackupAt ? formatDate(state.lastBackupAt) : 'Nunca';
  const needsReminder = !state.lastBackupAt || Date.now() - Date.parse(state.lastBackupAt) > 7 * 24 * 60 * 60 * 1000;
  $('[data-backup-reminder]').textContent = needsReminder
    ? 'Conviene generar una copia y guardarla en un lugar seguro.'
    : 'Guardá otra copia después de cambios importantes.';
  $('[data-action="exit-example"]').hidden = state.mode !== 'example';
}

async function exportBackup() {
  const now = new Date().toISOString();
  const nextState = { ...state, lastBackupAt: now, updatedAt: now };
  let backup;
  let blob;
  try {
    backup = buildBackup(nextState, now);
    blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    if (blob.size > MAX_BACKUP_BYTES) throw new Error(`La copia supera el máximo de ${MAX_BACKUP_BYTES / 1024 / 1024} MB.`);
  } catch (error) {
    showGlobalError(`No se pudo generar la copia: ${error.message}`);
    return;
  }
  if (!await commit(nextState, 'Copia preparada. Elegí dónde guardar el archivo.', 'backup')) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sanez-stock-${now.slice(0, 10)}-${now.slice(11, 16).replace(':', '')}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function importBackup(file) {
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error(`El archivo supera el máximo de ${MAX_BACKUP_BYTES / 1024 / 1024} MB.`);
    const backup = JSON.parse(await file.text());
    const restored = validateBackup(backup);
    const confirmed = window.confirm(`Se reemplazarán los datos actuales por la copia del ${formatDate(backup.exportedAt)}.\n\nIncluye ${restored.products.length} productos y ${restored.history.length} registros. Esta acción no se puede deshacer salvo que tengas otra copia.\n\n¿Querés recuperarla?`);
    if (!confirmed) return;
    await commit(restored, 'Copia recuperada correctamente.', 'home');
  } catch (error) {
    showGlobalError(`No se pudo recuperar la copia: ${error.message}`);
  } finally {
    $('[data-import-file]').value = '';
  }
}

async function handleAction(action) {
  if (busy) return;
  if (action === 'start-example') await commit(createExampleState(), 'Modo ejemplo iniciado. Todos los datos son ficticios.');
  else if (action === 'start-real') await commit(createRealState(), 'Catálogo base listo. Cargá tus cantidades y precios actuales.');
  else if (action === 'entry' || action === 'exit') showMove(action);
  else if (action === 'add') showEdit(null);
  else if (action === 'back') showView('home');
  else if (action === 'history') showView('history');
  else if (action === 'toggle-archived') { includeArchived = !includeArchived; renderHome(); }
  else if (action === 'export') await exportBackup();
  else if (action === 'import') $('[data-import-file]').click();
  else if (action === 'archive') {
    const product = state.products.find((item) => item.id === editingId);
    if (!product) return;
    const warning = product.archived ? '¿Querés desarchivar este producto?' : `¿Querés archivar este producto? No se borra su stock ni su historial.${product.quantity ? ' Su stock seguirá incluido en las valoraciones.' : ''}`;
    if (window.confirm(warning)) await commit(setProductArchived(state, product.id, !product.archived, new Date().toISOString(), newId()), product.archived ? 'Producto desarchivado.' : 'Producto archivado.');
  } else if (action === 'exit-example') {
    if (window.confirm('Se quitarán todos los datos ficticios y se empezará con el catálogo real en cero. No se mezclarán con tus datos. ¿Querés continuar?')) {
      await commit(createRealState(), 'Saliste del ejemplo. El catálogo real empieza en cero y con precios sin cargar.');
    }
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.edit) showEdit(button.dataset.edit);
  else if (button.dataset.correct) showCorrection(button.dataset.correct);
  else if (button.dataset.tab) showView(button.dataset.tab);
  else if (button.dataset.action) await handleAction(button.dataset.action);
});

$('[data-search]').addEventListener('input', renderHome);
$('[data-move-form]').addEventListener('input', updateMovePreview);
$('[data-move-form]').addEventListener('change', updateMovePreview);
$('[data-move-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const form = event.currentTarget;
  try {
    const nextState = recordMovement(state, {
      productId: form.elements.product.value,
      direction,
      mode: form.elements.mode.value,
      quantity: Number(form.elements.quantity.value),
    }, new Date().toISOString(), newId());
    const units = Math.abs(nextState.history.at(-1).delta);
    await commit(nextState, `${direction === 'entry' ? 'Entrada' : 'Salida'} registrada: ${formatNumber(units)} unidades.`);
  } catch (error) {
    const element = $('[data-move-error]');
    element.textContent = error.message;
    element.hidden = false;
  }
});

$('[data-edit-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const input = productInputFromForm();
  const errorElement = $('[data-edit-error]');
  if ([input.costCents, input.saleCents, input.packSaleCents].some(Number.isNaN)) {
    errorElement.textContent = 'Revisá los precios. Usá por ejemplo 150 o 150,50, sin puntos de miles.';
    errorElement.hidden = false;
    return;
  }
  try {
    const editing = Boolean(editingId);
    const nextState = editing
      ? updateProduct(state, editingId, input, new Date().toISOString(), newId())
      : addProduct(state, input, new Date().toISOString(), newId());
    await commit(nextState, editing ? 'Cambios guardados. El historial anterior conserva sus datos originales.' : 'Producto agregado.');
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  }
});

$('[data-correction-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const form = event.currentTarget;
  try {
    const nextState = correctMovement(state, correctionId, Number(form.elements.corrected.value), form.elements.reason.value, new Date().toISOString(), newId());
    await commit(nextState, 'Corrección guardada. El registro original se conserva.', 'history');
  } catch (error) {
    const element = $('[data-correction-error]');
    element.textContent = error.message;
    element.hidden = false;
  }
});

$('[data-import-file]').addEventListener('change', (event) => importBackup(event.target.files[0]));

$('[data-pending-measures]').innerHTML = PENDING_MEASURES.map((item) => `<p class="hint block"><strong>${escapeHTML(item.measure)}</strong><br>${escapeHTML(item.note)}</p>`).join('');

async function initialize() {
  try {
    const saved = await loadState();
    if (saved) {
      validateState(saved);
      state = saved;
      currentView = 'home';
      setSaveStatus('Guardado en este dispositivo');
    }
  } catch (error) {
    console.error(error);
    showGlobalError(`No se pudieron leer los datos guardados: ${error.message}. No se reemplazaron automáticamente.`);
  }
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('No se pudo preparar el modo sin conexión.', error));
  }
}

initialize();
