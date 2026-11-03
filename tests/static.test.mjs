import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFile(resolve(root, path), 'utf8');

test('el manifiesto tiene nombre, modo instalable e íconos locales existentes', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Sánez Stock');
  assert.equal(manifest.short_name, 'Sánez Stock');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  for (const icon of manifest.icons) await access(resolve(root, icon.src));
  await access(resolve(root, 'assets/apple-touch-icon.png'));
  const html = await read('index.html');
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-touch-icon/);
});

test('todos los recursos necesarios para offline existen y son locales', async () => {
  const worker = await read('sw.js');
  const assets = [...worker.matchAll(/'(\.\/[^']*)'/g)].map((match) => match[1]);
  assert.ok(assets.length >= 10);
  for (const asset of new Set(assets)) {
    if (asset === './') continue;
    await access(resolve(root, asset));
  }
  const html = await read('index.html');
  const app = await read('src/app.js');
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//);
  assert.doesNotMatch(app, /fetch\(|XMLHttpRequest|sendBeacon|analytics/i);
});

test('el catálogo de origen quedó incluido en la entrega', async () => {
  await access(resolve(root, 'reference/catalogo-sanez-09-2026.pdf'));
});

test('no requiere dependencias instaladas', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
});
