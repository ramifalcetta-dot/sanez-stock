import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const temporary = await mkdtemp(join(tmpdir(), 'sanez-stock-browser-'));
const downloadDirectory = join(temporary, 'downloads');
const profileDirectory = join(temporary, 'profile');
let server;
let browser;
let cdp;

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function waitHttp(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await pause(100);
  }
  throw new Error(`No respondió ${url}`);
}

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.requests = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else if (message.method === 'Network.requestWillBeSent') {
        this.requests.push(message.params.request.url);
      }
    });
  }

  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async waitFor(expression, label) {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) return;
      } catch {}
      await pause(100);
    }
    throw new Error(`Tiempo agotado esperando: ${label}`);
  }

  close() {
    this.socket.close();
  }
}

async function readStoredState() {
  return cdp.evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open('sanez-stock', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const get = database.transaction('app', 'readonly').objectStore('app').get('state');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => { resolve(get.result); database.close(); };
    };
  })`);
}

async function waitForDownload() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const files = (await readdir(downloadDirectory)).filter((file) => file.endsWith('.json'));
    if (files.length) return join(downloadDirectory, files[0]);
    await pause(100);
  }
  throw new Error('No se generó el archivo de respaldo.');
}

function check(label) {
  console.log(`✔ ${label}`);
}

try {
  await access(edgePath);
  await import('node:fs/promises').then(({ mkdir }) => mkdir(downloadDirectory));
  const appPort = await freePort();
  const debugPort = await freePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  server = spawn(process.execPath, ['tools/serve.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(appPort) },
    stdio: 'ignore',
  });
  await waitHttp(`${baseUrl}/index.html`);

  browser = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ], { stdio: 'ignore' });
  await waitHttp(`http://127.0.0.1:${debugPort}/json/version`);
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
  const target = await targetResponse.json();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Network.enable');
  await cdp.call('DOM.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory });

  await cdp.call('Page.navigate', { url: baseUrl });
  await cdp.waitFor(`document.readyState === 'complete' && !document.querySelector('[data-view="welcome"]').hidden`, 'primer ingreso');
  check('primer ingreso y catálogo base disponibles');

  await cdp.evaluate(`document.querySelector('[data-action="start-real"]').click()`);
  await cdp.waitFor(`!document.querySelector('[data-view="home"]').hidden && document.querySelectorAll('[data-products] .product').length === 9`, 'catálogo real');
  let stored = await readStoredState();
  assert.equal(stored.products.length, 9);
  assert.ok(stored.products.every((product) => product.quantity === 0 && product.costCents === null));
  check('IndexedDB guarda el catálogo en cero y con precios sin cargar');

  await cdp.evaluate(`document.querySelector('[data-action="add"]').click()`);
  await cdp.waitFor(`!document.querySelector('[data-view="edit"]').hidden`, 'formulario de producto');
  await cdp.evaluate(`(() => {
    const form = document.querySelector('[data-edit-form]');
    form.elements.name.value = 'Producto navegador';
    form.elements.measure.value = '25 × 8 × 20';
    form.elements.pack.value = '4';
    form.elements.minimum.value = '2';
    form.elements.cost.value = '10,50';
    form.elements.sale.value = '21';
    form.elements.packsale.value = '80';
    form.elements.initial.value = '12';
    form.requestSubmit();
  })()`);
  await cdp.waitFor(`!document.querySelector('[data-view="home"]').hidden && document.querySelector('[data-products]').textContent.includes('12 unidades')`, 'producto agregado');
  stored = await readStoredState();
  const added = stored.products.find((product) => product.name === 'Producto navegador');
  assert.equal(added.costCents, 1050);
  assert.equal(added.saleCents, 2100);
  assert.equal(added.packSaleCents, 8000);
  check('alta, medidas y edición de precios llegan a IndexedDB');

  await cdp.evaluate(`document.querySelector('[data-action="entry"]').click()`);
  await cdp.evaluate(`(() => {
    const form = document.querySelector('[data-move-form]');
    form.elements.product.value = [...form.elements.product.options].find((option) => option.textContent.includes('Producto navegador')).value;
    form.elements.mode.value = 'pack';
    form.elements.quantity.value = '2';
    form.requestSubmit();
  })()`);
  await cdp.waitFor(`!document.querySelector('[data-view="home"]').hidden && document.querySelector('[data-products]').textContent.includes('20 unidades')`, 'entrada por paquetes');
  check('una entrada de 2 paquetes de 4 suma 8 unidades');

  await cdp.evaluate(`document.querySelector('[data-action="exit"]').click()`);
  await cdp.evaluate(`(() => {
    const form = document.querySelector('[data-move-form]');
    form.elements.product.value = [...form.elements.product.options].find((option) => option.textContent.includes('Producto navegador')).value;
    form.elements.quantity.value = '21';
    form.requestSubmit();
  })()`);
  await cdp.waitFor(`!document.querySelector('[data-move-error]').hidden`, 'rechazo de stock negativo');
  stored = await readStoredState();
  assert.equal(stored.products.find((product) => product.id === added.id).quantity, 20);
  check('la interfaz rechaza una salida mayor al stock sin modificarlo');

  await cdp.evaluate(`(() => {
    const form = document.querySelector('[data-move-form]');
    form.elements.quantity.value = '3';
    form.requestSubmit();
  })()`);
  await cdp.waitFor(`!document.querySelector('[data-view="home"]').hidden && document.querySelector('[data-products]').textContent.includes('17 unidades')`, 'salida válida');
  await cdp.evaluate(`document.querySelector('[data-tab="history"]').click()`);
  await cdp.waitFor(`!document.querySelector('[data-view="history"]').hidden`, 'historial');
  await cdp.evaluate(`document.querySelector('[data-correct]').click()`);
  await cdp.evaluate(`(() => {
    const form = document.querySelector('[data-correction-form]');
    form.elements.corrected.value = '2';
    form.elements.reason.value = 'Corrección de navegador';
    form.requestSubmit();
  })()`);
  await cdp.waitFor(`!document.querySelector('[data-view="history"]').hidden && document.querySelector('[data-history]').textContent.includes('Corrección de navegador')`, 'corrección guardada');
  stored = await readStoredState();
  assert.equal(stored.products.find((product) => product.id === added.id).quantity, 18);
  assert.equal(stored.history.at(-1).type, 'correction');
  assert.equal(stored.history.at(-2).delta, -3);
  check('la corrección ajusta stock y conserva el movimiento original');

  await cdp.call('Page.reload', { ignoreCache: true });
  await cdp.waitFor(`document.readyState === 'complete' && !document.querySelector('[data-view="home"]').hidden && document.querySelector('[data-products]').textContent.includes('18 unidades')`, 'persistencia tras recargar');
  check('los datos sobreviven una recarga completa');

  await cdp.evaluate(`document.querySelector('[data-tab="backup"]').click()`);
  await cdp.evaluate(`document.querySelector('[data-action="export"]').click()`);
  const backupPath = await waitForDownload();
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(backup.app, 'Sánez Stock');
  assert.equal(backup.data.products.find((product) => product.id === added.id).quantity, 18);
  check('Guardar copia exporta todos los datos en un archivo JSON');

  await cdp.evaluate(`document.querySelector('[data-tab="home"]').click()`);
  await cdp.evaluate(`document.querySelector('[data-action="exit"]').click()`);
  await cdp.evaluate(`(() => {
    const form = document.querySelector('[data-move-form]');
    form.elements.product.value = ${JSON.stringify(added.id)};
    form.elements.quantity.value = '1';
    form.requestSubmit();
  })()`);
  await cdp.waitFor(`document.querySelector('[data-products]').textContent.includes('17 unidades')`, 'cambio posterior al respaldo');
  await cdp.evaluate(`window.confirm = () => true; document.querySelector('[data-tab="backup"]').click()`);
  const documentNode = await cdp.call('DOM.getDocument', { depth: 1 });
  const fileInput = await cdp.call('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '[data-import-file]' });
  await cdp.call('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [backupPath] });
  await cdp.waitFor(`!document.querySelector('[data-view="home"]').hidden && document.querySelector('[data-products]').textContent.includes('18 unidades')`, 'restauración del respaldo');
  stored = await readStoredState();
  assert.equal(stored.products.find((product) => product.id === added.id).quantity, 18);
  check('Recuperar copia valida, confirma y reemplaza el estado en IndexedDB');

  await cdp.evaluate(`navigator.serviceWorker.ready`);
  await cdp.call('Page.reload');
  await cdp.waitFor(`document.readyState === 'complete' && navigator.serviceWorker.controller !== null`, 'control del service worker');
  await cdp.waitFor(`!document.querySelector('[data-view="home"]').hidden`, 'inicio controlado por el service worker');
  await cdp.call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await cdp.call('Page.reload');
  await cdp.waitFor(`document.readyState === 'complete' && !document.querySelector('[data-view="home"]').hidden && document.querySelector('[data-products]').textContent.includes('18 unidades')`, 'recarga sin conexión');
  await cdp.call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  check('la aplicación y sus datos abren tras una recarga sin red');

  const externalRequests = cdp.requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== baseUrl);
  assert.deepEqual(externalRequests, []);
  check('no se detectaron solicitudes a servidores externos');

  if (process.env.SANEZ_SCREENSHOT) {
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.SANEZ_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  console.log('\nPrueba de navegador completada: 11 comprobaciones correctas.');
  await cdp.call('Browser.close');
} finally {
  if (cdp) cdp.close();
  if (browser && !browser.killed) browser.kill();
  if (server && !server.killed) server.kill();
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
