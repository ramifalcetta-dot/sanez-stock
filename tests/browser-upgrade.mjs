import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const previousVersion = '600583d'; // versión publicada antes del rediseño SANEZ-UI-02
const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const temporary = await mkdtemp(join(tmpdir(), 'sanez-stock-upgrade-'));
const oldRoot = join(temporary, 'old');
const profileDirectory = join(temporary, 'profile');
const exec = promisify(execFile);
const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
let servingRoot = oldRoot;
let server;
let browser;
let cdp;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

async function freePort() {
  const socket = createServer();
  await new Promise((resolveListen) => socket.listen(0, '127.0.0.1', resolveListen));
  const port = socket.address().port;
  await new Promise((resolveClose) => socket.close(resolveClose));
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
  }

  async open() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }

  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject, method });
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
        if (await this.evaluate(`(async () => Boolean(await (${expression})))()`)) return;
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

async function waitForHome() {
  await cdp.waitFor(`document.readyState === 'complete' && !document.querySelector('[data-view="home"]').hidden`, 'inicio con datos previos');
}

async function reload(ignoreCache = false) {
  await cdp.evaluate(`window.__sanezUpgradePreviousPage = true`);
  await cdp.call('Page.reload', { ignoreCache });
  await cdp.waitFor(`!window.__sanezUpgradePreviousPage && document.readyState === 'complete'`, 'documento recargado');
}

function check(label) {
  console.log(`✔ ${label}`);
}

try {
  await access(edgePath);
  const files = (await exec('git', ['ls-tree', '-r', '--name-only', previousVersion], { cwd: root })).stdout
    .split(/\r?\n/)
    .filter((file) => /^(index\.html|styles\.css|manifest\.webmanifest|sw\.js|src\/|assets\/)/.test(file));
  for (const file of files) {
    const contents = await exec('git', ['show', `${previousVersion}:${file}`], { cwd: root, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
    const destination = join(oldRoot, ...file.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents.stdout);
  }
  assert.match(await readFile(join(oldRoot, 'sw.js'), 'utf8'), /sanez-stock-v2/);
  assert.doesNotMatch(await readFile(join(oldRoot, 'styles.css'), 'utf8'), /--espresso/);

  const appPort = await freePort();
  const debugPort = await freePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(servingRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (file !== servingRoot && !file.startsWith(`${resolve(servingRoot)}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveListen) => server.listen(appPort, '127.0.0.1', resolveListen));
  await waitHttp(`${baseUrl}/index.html`);

  browser = spawn(edgePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDirectory}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitHttp(`http://127.0.0.1:${debugPort}/json/version`);
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
  const target = await targetResponse.json();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Network.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  await cdp.call('Page.navigate', { url: baseUrl });
  await cdp.waitFor(`document.readyState === 'complete' && !document.querySelector('[data-view="welcome"]').hidden`, 'versión anterior');
  await cdp.evaluate(`document.querySelector('[data-action="start-real"]').click()`);
  await waitForHome();
  await cdp.evaluate(`document.querySelector('[data-action="add"]').click()`);
  await cdp.evaluate(`(() => {
    const form = document.querySelector('[data-edit-form]');
    form.elements.name.value = 'Producto previo a actualizar';
    form.elements.measure.value = '30 × 22 × 9';
    form.elements.pack.value = '5';
    form.elements.minimum.value = '2';
    form.elements.cost.value = '12,34';
    form.elements.sale.value = '23,45';
    form.elements.packsale.value = '100';
    form.elements.initial.value = '20';
    form.requestSubmit();
  })()`);
  await cdp.waitFor(`!document.querySelector('[data-view="home"]').hidden && document.querySelector('[data-products]').textContent.includes('20 unidades')`, 'producto previo');
  await cdp.evaluate(`document.querySelector('[data-action="exit"]').click()`);
  await cdp.evaluate(`(() => {
    const form = document.querySelector('[data-move-form]');
    form.elements.product.value = [...form.elements.product.options].find((option) => option.textContent.includes('Producto previo a actualizar')).value;
    form.elements.quantity.value = '5';
    form.requestSubmit();
  })()`);
  await cdp.waitFor(`document.querySelector('[data-products]').textContent.includes('15 unidades')`, 'salida previa');
  await cdp.evaluate(`document.querySelector('[data-tab="history"]').click()`);
  await cdp.evaluate(`document.querySelector('[data-correct]').click()`);
  await cdp.evaluate(`(() => {
    const form = document.querySelector('[data-correction-form]');
    form.elements.corrected.value = '3';
    form.elements.reason.value = 'Corrección creada en la versión anterior';
    form.requestSubmit();
  })()`);
  await cdp.waitFor(`document.querySelector('[data-history]').textContent.includes('Corrección creada en la versión anterior')`, 'historial previo');
  await cdp.evaluate(`navigator.serviceWorker.ready`);
  await reload();
  await waitForHome();
  await cdp.waitFor(`navigator.serviceWorker.controller && caches.has('sanez-stock-v2')`, 'caché de la versión anterior');
  const before = await readStoredState();
  const product = before.products.find((item) => item.name === 'Producto previo a actualizar');
  assert.equal(product.quantity, 17);
  assert.equal(product.costCents, 1234);
  assert.equal(product.saleCents, 2345);
  assert.equal(before.history.at(-1).type, 'correction');
  check('la versión publicada anterior conserva datos reales de prueba y su caché v2');

  servingRoot = root;
  await reload(true);
  await cdp.waitFor(`caches.has('sanez-stock-v3')`, 'instalación de la caché nueva');
  await cdp.waitFor(`caches.has('sanez-stock-v3').then(async (hasNew) => hasNew && !(await caches.has('sanez-stock-v2')))`, 'service worker nuevo activo y caché anterior eliminada');
  await reload();
  await waitForHome();
  assert.deepEqual(await readStoredState(), before);
  check('la actualización a v3 no modifica productos, cantidades, precios ni historial');

  await cdp.call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await reload();
  await waitForHome();
  assert.deepEqual(await readStoredState(), before);
  const offlineCheck = await cdp.evaluate(`import('./src/domain.js').then((domain) => {
    const original = structuredClone(${JSON.stringify(before)});
    const exit = original.history.find((event) => event.type === 'exit');
    const corrected = domain.correctMovement(original, exit.id, 4, 'Verificación sin guardar', '2026-11-03T12:00:00.000Z', 'offline-check');
    return {
      limit: domain.MAX_BACKUP_BYTES,
      quantity: corrected.products.find((item) => item.id === exit.productId).quantity,
      delta: corrected.history.at(-1).delta,
    };
  })`);
  assert.equal(offlineCheck.limit, 50 * 1024 * 1024);
  assert.equal(offlineCheck.quantity, 16);
  assert.equal(offlineCheck.delta, -1);
  assert.ok(await cdp.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--espresso').trim() !== '' && document.querySelector('.decor') !== null`), 'sin conexión se ve el diseño nuevo');
  assert.deepEqual(await readStoredState(), before);
  check('la apertura offline usa el código nuevo, conserva el estado y calcula bien una segunda corrección sin guardarla');

  console.log('\nPrueba de actualización completada: 3 comprobaciones correctas.');
  await cdp.call('Browser.close');
} finally {
  if (cdp) cdp.close();
  if (browser && !browser.killed) browser.kill();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
