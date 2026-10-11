const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawnBackend, ensureBackend, probeBackend } = require('../electron-shell/backend-process');
const http = require('node:http');
const logger = { log() {}, warn() {} };

function fakeSpawner(failures) {
  const calls = [];
  return { calls, probe:async()=> 'ready', spawnProcess(bin, args, options) {
    calls.push({ bin, args, options });
    const child = new EventEmitter();
    child.kill = () => { child.signalCode = 'SIGTERM'; process.nextTick(()=>child.emit('exit',null,'SIGTERM')); };
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
    env: {}, logger, existsSync: () => true, probe:fake.probe,
    spawnProcess(...args) {
      if (first) { first = false; throw new Error('invalid launch'); }
      return fake.spawnProcess(...args);
    },
  });
  assert.ok(child);
});

test('health probe rejects a different service, HTTP errors and malformed data',async t=>{
  let body={status:'ok',service:'star-office-ui'}, status=200;
  const server=http.createServer((request,response)=>{response.writeHead(status);response.end(typeof body==='string'?body:JSON.stringify(body));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  assert.equal(await probeBackend(baseUrl),'ready');
  assert.equal(await ensureBackend('/office',{baseUrl,spawnProcess(){throw new Error('must reuse');}}),null);
  body={status:'ok',service:'other'};
  assert.equal(await probeBackend(baseUrl),'foreign');
  await assert.rejects(ensureBackend('/office',{baseUrl,spawnProcess(){throw new Error('must not spawn');}}),/another service/);
  body={status:'ok',service:'star-office-ui'};status=503;
  assert.equal(await probeBackend(baseUrl),'foreign');
  body='not json';status=200;
  assert.equal(await probeBackend(baseUrl),'foreign');
});

test('an interpreter that exits after spawn falls back to the next candidate',async()=>{
  const children=[];
  const child=await spawnBackend('/office',{
    env:{},logger,existsSync:()=>true,pollMs:1,
    spawnProcess(){
      const child=new EventEmitter();children.push(child);
      child.kill=()=>{child.signalCode='SIGTERM';child.emit('exit');};
      process.nextTick(()=>{child.emit('spawn');if(children.length===1){child.exitCode=1;child.emit('exit',1);}});
      return child;
    },
    probe:async()=> 'ready',
  });
  assert.equal(children.length,2);assert.equal(child,children[1]);
});

test('startup timeouts stop owned candidates and fail instead of opening an unavailable backend',async()=>{
  const children=[];
  await assert.rejects(ensureBackend('/office',{
    env:{},logger,existsSync:()=>true,timeoutMs:2,pollMs:1,probe:async()=> 'unavailable',
    spawnProcess(){
      const child=new EventEmitter();children.push(child);child.killed=false;
      child.kill=()=>{child.killed=true;child.signalCode='SIGTERM';child.emit('exit');};
      process.nextTick(()=>child.emit('spawn'));return child;
    },
  }),/Cannot start/);
  assert.equal(children.length,3);assert.ok(children.every(child=>child.killed));
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
