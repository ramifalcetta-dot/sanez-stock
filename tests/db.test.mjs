import test from 'node:test';
import assert from 'node:assert/strict';
import { saveState } from '../src/db.js';

function installIndexedDBMock(t, abortAfterRequest) {
  const original = globalThis.indexedDB;
  const database = {
    closed: false,
    close() { this.closed = true; },
    transaction() {
      const transaction = {
        error: abortAfterRequest ? new Error('Abort posterior al request') : null,
        objectStore() {
          return {
            put() {
              const request = {};
              queueMicrotask(() => {
                request.onsuccess?.();
                setTimeout(() => {
                  if (abortAfterRequest) transaction.onabort?.();
                  else transaction.oncomplete?.();
                }, 0);
              });
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    },
  };
  t.after(() => { globalThis.indexedDB = original; });
  return database;
}

test('saveState espera oncomplete y propaga un abort posterior al request.onsuccess', async (t) => {
  const database = installIndexedDBMock(t, true);
  await assert.rejects(saveState({ preserved: true }), /Abort posterior/);
  assert.equal(database.closed, true);
});

test('saveState confirma después del commit de la transacción', async (t) => {
  const database = installIndexedDBMock(t, false);
  await saveState({ preserved: true });
  assert.equal(database.closed, true);
});
