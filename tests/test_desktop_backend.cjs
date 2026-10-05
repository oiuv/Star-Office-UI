const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawnBackend } = require('../electron-shell/backend-process');
const logger = { log() {}, warn() {} };

function fakeSpawner(failures) {
  const calls = [];
  return { calls, spawnProcess(bin, args, options) {
    calls.push({ bin, args, options });
    const child = new EventEmitter();
    process.nextTick(() => child.emit(calls.length <= failures ? 'error' : 'spawn', new Error('ENOENT')));
    return child;
  } };
}

test('Windows falls back after an asynchronous Python error to Scripts/python.exe', async () => {
  const fake = fakeSpawner(1);
  const child = await spawnBackend('/office', { ...fake, env: { STAR_BACKEND_PYTHON: 'missing-python' }, platform: 'win32', existsSync: () => true, logger });
  assert.ok(child);
  assert.deepEqual(fake.calls.map(c => c.bin), ['missing-python', path.join('/office', '.venv', 'Scripts', 'python.exe')]);
  assert.ok(fake.calls.every(c => c.options.windowsHide));
  assert.doesNotThrow(() => child.emit('error', new Error('late process error')));
});

test('Missing virtual environment falls back to a system Python', async () => {
  const fake = fakeSpawner(2);
  const child = await spawnBackend('/office', { ...fake, env: {}, platform: 'linux', existsSync: () => true, logger });
  assert.ok(child);
  assert.deepEqual(fake.calls.map(c => c.bin), [path.join('/office', '.venv', 'bin', 'python'), 'python3', 'python']);
});

test('All missing interpreters and missing backend fail without unhandled errors', async () => {
  const fake = fakeSpawner(9);
  assert.equal(await spawnBackend('/office', { ...fake, env: {}, existsSync: () => true, logger }), null);
  assert.equal(fake.calls.length, 3);
  assert.equal(await spawnBackend('/office', { ...fake, existsSync: () => false, logger }), null);
  assert.equal(fake.calls.length, 3);
});

test('Synchronous launch failures also try the next interpreter', async () => {
  const fake = fakeSpawner(0);
  let first = true;
  const child = await spawnBackend('/office', {
    env: {}, logger, existsSync: () => true,
    spawnProcess(...args) {
      if (first) { first = false; throw new Error('invalid launch'); }
      return fake.spawnProcess(...args);
    },
  });
  assert.ok(child);
});

const miniHtml = fs.readFileSync(path.join(__dirname, '../desktop-pet/src/minimized.html'), 'utf8');
const miniScript = miniHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
for (const electron of [false, true]) {
  for (const baseUrl of ['http://127.0.0.1:19000', 'http://127.0.0.1:19123']) {
    test(`Mini loads assets and status from ${baseUrl}, Electron=${electron}`, async () => {
      const requests = [], images = [];
      const context = { clearRect() {}, drawImage() {} };
      const element = { style: {}, getContext: () => context };
      const window = { location: { search: baseUrl.endsWith('19000') ? '' : `?backendUrl=${encodeURIComponent(baseUrl)}` } };
      if (electron) {
        window.__ELECTRON__ = true;
        window.__TAURI__ = { core: { invoke: async () => ({ state: 'writing' }) }, window: { getCurrentWindow: () => ({}) } };
      }
      await vm.runInNewContext(miniScript, {
        window, URLSearchParams,
        document: { getElementById: () => element, body: { classList: { add() {} } }, addEventListener() {} },
        Image: class { set src(value) { images.push(value); } },
        fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ state: 'writing' }) }; },
        requestAnimationFrame() {}, cancelAnimationFrame() {}, setInterval() {},
      });
      assert.equal(images.length, 1);
      assert.ok(images[0].startsWith(`${baseUrl}/static/star-working-`));
      assert.deepEqual(requests, electron ? [] : [`${baseUrl}/status`]);
    });
  }
}
