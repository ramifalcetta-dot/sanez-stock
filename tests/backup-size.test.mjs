import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MAX_BACKUP_BYTES, buildBackup, validateBackup } from '../src/domain.js';

function largeBackup() {
  const now = '2026-11-03T12:00:00.000Z';
  const product = {
    id: 'large-product', name: 'Historial grande', measure: '', unitsPerPack: 1, minimum: 0,
    quantity: 12000, costCents: 100, saleCents: 200, packSaleCents: null, archived: false,
    reference: null, createdAt: now, updatedAt: now,
  };
  const history = [{ id: 'created', type: 'product', productId: product.id, productName: product.name, measure: '', at: now }];
  for (let index = 0; index < 12000; index += 1) {
    history.push({
      id: `entry-${index}`, type: 'entry', productId: product.id, productName: product.name,
      measure: '', at: now, delta: 1, beforeStock: index, afterStock: index + 1,
      inputMode: 'unit', inputQuantity: 1, unitsPerPack: 1,
      costCents: 100, saleCents: 200, packSaleCents: null,
    });
  }
  return buildBackup({
    schemaVersion: 1, mode: 'real', createdAt: now, updatedAt: now, lastBackupAt: null,
    products: [product], history,
  }, now);
}

test('un respaldo válido de 12000 movimientos entra en el límite compartido y se recupera', () => {
  const backup = largeBackup();
  const serialized = JSON.stringify(backup, null, 2);
  const bytes = Buffer.byteLength(serialized);
  assert.ok(bytes > 5 * 1024 * 1024, `el caso debe superar el límite anterior; obtuvo ${bytes}`);
  assert.ok(bytes <= MAX_BACKUP_BYTES);
  const restored = validateBackup(JSON.parse(serialized));
  assert.equal(restored.history.length, 12001);
  assert.equal(restored.products[0].quantity, 12000);
});

test('importación y exportación usan el mismo límite de tamaño', async () => {
  const source = await readFile(fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8');
  assert.match(source, /file\.size > MAX_BACKUP_BYTES/);
  assert.match(source, /blob\.size > MAX_BACKUP_BYTES/);
  assert.doesNotMatch(source, /file\.size > 5 \* 1024 \* 1024/);
});
