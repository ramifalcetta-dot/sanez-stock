const DATABASE_NAME = 'sanez-stock';
const STORE_NAME = 'app';
const STATE_KEY = 'state';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña.'));
  });
}

function runTransaction(database, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('No se pudo completar el guardado.'));
  });
}

export async function loadState() {
  const database = await openDatabase();
  try {
    return await runTransaction(database, 'readonly', (store) => store.get(STATE_KEY)) ?? null;
  } finally {
    database.close();
  }
}

export async function saveState(state) {
  const database = await openDatabase();
  try {
    await runTransaction(database, 'readwrite', (store) => store.put(state, STATE_KEY));
  } finally {
    database.close();
  }
}
