import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDispatcher } from '../runtime/dispatcher.mjs';

const sourceFile = fileURLToPath(new URL('../desktop/ui/shenshen-actions.js', import.meta.url));
const source = fs.readFileSync(sourceFile, 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function harness(options = {}) {
  const window = {}, timers = new Map(), shown = [], prepared = [];
  let serial = 0, protectedNow = false;
  vm.runInNewContext(source, { window, setTimeout, clearTimeout }, { filename: sourceFile });
  const api = window.ShenshenActions;
  const controller = api.createController({
    show: action => shown.push(action),
    prepare: async action => { prepared.push(action); },
    isProtected: () => protectedNow,
    schedule: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    cancel: id => timers.delete(id),
    ...options,
  });
  return { api, controller, shown, prepared, timers, protect: value => { protectedNow = value; },
    expire() { const [id, timer] = [...timers].at(-1); timers.delete(id); timer.fn(); } };
}

test('the seven actions use stable APNG sources within the alpha cache budget', () => {
  const h = harness();
  assert.deepEqual(Array.from(h.api.actions), ['idle', 'working', 'thinking', 'celebrate', 'failed', 'wave', 'jump']);
  const urls = h.api.actions.map(action => h.api.assetUrl(action));
  assert.equal(new Set(urls).size, 7);
  assert.ok(urls.every(url => /^\/assets\/shenshen-[a-z]+\.png$/.test(url)));
  assert.throws(() => h.api.assetUrl('../bad'), /action/i);
});

test('all action files contain six APNG frames and transient timers match one complete cycle', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/shenshen-manifest.json', import.meta.url), 'utf8'));
  const h = harness(); await settle();
  for (const action of h.api.actions) {
    const spec = manifest.states[action];
    assert.equal(spec.frameCount, 6); assert.equal(spec.uniqueFrames, 6);
    const bytes = fs.readFileSync(new URL('../assets/' + spec.file, import.meta.url));
    const frames = []; let advertisedFrames = 0;
    for (let offset = 8; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
      if (type === 'acTL') advertisedFrames = bytes.readUInt32BE(offset + 8);
      if (type === 'fcTL') frames.push(bytes.readUInt16BE(offset + 28) / (bytes.readUInt16BE(offset + 30) || 100) * 1000);
      offset += size + 12;
    }
    assert.equal(advertisedFrames, 6); assert.deepEqual(frames, spec.durationMs);
    assert.equal(bytes.readUInt32BE(16), manifest.width); assert.equal(bytes.readUInt32BE(20), manifest.height);
    if (action === 'idle' || action === 'working') continue;
    h.controller.trigger(action); await settle();
    assert.equal([...h.timers.values()][0].ms, frames.reduce((a, b) => a + b, 0));
    h.expire(); await settle();
  }
});

test('idle becomes working for any active Codex turn and returns when all turns finish', async () => {
  const h = harness(); await settle();
  h.controller.setMonitor({ activeTurns: 3 }); await settle();
  h.controller.setMonitor({ activeTurns: 1 }); await settle();
  h.controller.setMonitor({ activeTurns: 0 }); await settle();
  assert.deepEqual(h.shown, ['idle', 'working', 'idle']);
});

test('invalid status payloads preserve the last known task state', async () => {
  const h = harness(); await settle(); h.controller.setMonitor({ activeTurns: 1 }); await settle();
  for (const status of [null, [], '', {}, { activeTurns: '0' }, { activeTurns: -1 }, { activeTurns: Infinity }, { activeTurns: NaN }]) h.controller.setMonitor(status);
  await settle(); assert.equal(h.shown.at(-1), 'working');
});

for (const [kind, action] of [['success', 'celebrate'], ['failed', 'failed']]) {
  test(`${kind} notice plays ${action}, then restores the newest monitored state`, async () => {
    const h = harness(); await settle(); h.controller.setMonitor({ activeTurns: 2 }); await settle();
    h.controller.onNotice({ id: '任务 🐱', completionKind: kind }); await settle();
    h.controller.setMonitor({ activeTurns: 0 }); await settle();
    assert.equal(h.shown.at(-1), action); h.expire(); await settle();
    assert.equal(h.shown.at(-1), 'idle');
  });
}

test('cancelled and unknown notices do not pretend to be task failures', async () => {
  const h = harness(); await settle();
  h.controller.onNotice({ id: 'a', completionKind: 'success' }); await settle();
  h.controller.onNotice({ id: 'b', completionKind: 'cancelled' }); await settle();
  for (const notice of [null, {}, { completionKind: 'waiting-for-approval' }]) h.controller.onNotice(notice);
  await settle(); assert.deepEqual(h.shown, ['idle', 'celebrate', 'idle']); assert.equal(h.timers.size, 0);
});

test('repeated completion IDs do not restart the animation', async () => {
  const h = harness(); await settle();
  h.controller.onNotice({ id: 'same', completionKind: 'failed' }); await settle();
  const oldTimer = [...h.timers.keys()][0];
  h.controller.onNotice({ id: 'same', completionKind: 'failed' }); await settle();
  assert.equal(h.shown.filter(a => a === 'failed').length, 1);
  assert.equal([...h.timers.keys()][0], oldTimer);
});

test('press and rebound protection queue a short action without changing the source', async () => {
  const h = harness(); await settle(); h.protect(true);
  h.controller.trigger('wave'); await settle();
  h.controller.setMonitor({ activeTurns: 1 }); await settle();
  assert.deepEqual(h.shown, ['idle']); assert.equal(h.timers.size, 0);
  h.protect(false); h.controller.flush(); await settle();
  assert.equal(h.shown.at(-1), 'wave'); h.expire(); await settle();
  assert.equal(h.shown.at(-1), 'working');
});

test('a new press during image preparation postpones the source change', async () => {
  const load = deferred(), h = harness({ prepare: action => action === 'jump' ? load.promise : Promise.resolve() });
  await settle(); h.controller.trigger('jump'); h.protect(true); load.resolve(); await settle();
  assert.deepEqual(h.shown, ['idle']); h.protect(false); h.controller.flush(); await settle();
  assert.equal(h.shown.at(-1), 'jump');
});

test('late decoding cannot overwrite a newer task state', async () => {
  const load = deferred(), h = harness({ prepare: action => action === 'working' ? load.promise : Promise.resolve() });
  await settle(); h.controller.setMonitor({ activeTurns: 1 }); h.controller.setMonitor({ activeTurns: 0 });
  load.resolve(); await settle(); assert.deepEqual(h.shown, ['idle']);
});

test('broken action art preserves usable art instead of changing the task into failure', async () => {
  const h = harness({ prepare: async action => { if (action === 'working') throw new Error('decode failed'); } });
  await settle(); h.controller.setMonitor({ activeTurns: 1 }); await settle();
  assert.deepEqual(h.shown, ['idle']); assert.equal(h.controller.status().base, 'working');
  h.controller.trigger('wave'); await settle(); assert.equal(h.shown.at(-1), 'wave');
});

test('changing to a custom role cancels timers and pending loads', async () => {
  const load = deferred(), h = harness({ prepare: action => action === 'wave' ? load.promise : Promise.resolve() });
  await settle(); h.controller.trigger('wave'); h.controller.setEnabled(false); load.resolve(); await settle();
  h.controller.onNotice({ completionKind: 'failed' }); h.controller.setMonitor({ activeTurns: 1 }); await settle();
  assert.deepEqual(h.shown, ['idle']); assert.equal(h.timers.size, 0);
  h.controller.setEnabled(true); await settle(); assert.equal(h.shown.at(-1), 'working');
});

test('a replaced transient timer cannot stop its successor; thinking is manual only', async () => {
  const h = harness(); await settle(); h.controller.trigger('thinking'); await settle();
  const stale = [...h.timers.values()][0].fn;
  h.controller.trigger('jump'); await settle(); stale(); await settle();
  assert.equal(h.shown.at(-1), 'jump'); h.expire(); await settle(); assert.equal(h.shown.at(-1), 'idle');
  assert.equal(h.controller.trigger('unknown'), false);
});

test('disposal cancels pending work and callbacks', async () => {
  const h = harness(); await settle(); h.controller.trigger('wave'); await settle();
  h.controller.dispose(); h.controller.setMonitor({ activeTurns: 1 }); h.controller.trigger('jump'); h.controller.flush(); await settle();
  assert.equal(h.timers.size, 0); assert.deepEqual(h.shown, ['idle', 'wave']);
});

function desktopHarness({ role = 'default' } = {}) {
  const documentEvents = {}, windowEvents = {}, intervals = [], sources = [], masks = [], timers = new Map();
  const classes = new Set(); let protectedNow = false, held = false, requests = 0, timerId = 0;
  let reply = { ok: true, monitor: { activeTurns: 0 } }, fail = false, httpOk = true, mutation;
  const pet = { dataset: {}, set src(value) { sources.push(value); }, get src() { return sources.at(-1); } };
  const root = { classList: { contains: value => classes.has(value) } };
  const listen = (map, name, fn) => { (map[name] ||= []).push(fn); };
  const document = { hidden: false, querySelector: selector => selector === '.dshwv-img' ? pet : root,
    addEventListener: (name, fn) => listen(documentEvents, name, fn) };
  const window = { whaleDesktop: {}, WhaleRendering: {
    hitCache: { prepare: async url => { masks.push(url); } }, presentFor() {},
    petInteraction: { holding: () => held, protectedBounds: () => protectedNow ? {} : null },
  }, addEventListener: (name, fn) => listen(windowEvents, name, fn) };
  vm.runInNewContext(source, { window, document, localStorage: { getItem: () => role },
    Image: class { decode() { return Promise.resolve(); } },
    MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} },
    fetch: async () => { requests++; if (fail) throw new Error('offline'); return { ok: httpOk, json: async () => reply }; },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {},
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
  }, { filename: sourceFile });
  return { pet, document, sources, masks, intervals, timers, requests: () => requests,
    reply: value => { reply = value; }, offline: value => { fail = value; }, http: value => { httpOk = value; },
    protected: value => { protectedNow = value; },
    down() { held = true; protectedNow = true; classes.add('dshwv-dragging'); this.event('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }); },
    rebound() { held = false; classes.delete('dshwv-dragging'); mutation(); },
    event(name, detail) { for (const fn of documentEvents[name] || []) fn(detail); },
    window(name, detail) { for (const fn of windowEvents[name] || []) fn({ detail }); },
  };
}

test('desktop pointer release waits through the existing press and rebound before waving', async () => {
  const h = desktopHarness(); await settle();
  h.down(); h.event('pointerup', { pointerId: 1, clientX: 100, clientY: 100 }); h.rebound(); await settle();
  assert.deepEqual(h.sources, ['/assets/shenshen-idle.png']);
  h.protected(false); h.window('whale-interaction-geometry'); await settle();
  assert.equal(h.sources.at(-1), '/assets/shenshen-wave.png');
  assert.equal(new Set(h.masks).size, 7);
  assert.equal(h.intervals[0].ms, 3000);
});

test('desktop drag drop jumps; cancelled drags and other pointer IDs do not react', async () => {
  const h = desktopHarness(); await settle(); h.down();
  h.event('pointermove', { pointerId: 1, clientX: 110, clientY: 100 });
  h.event('pointerup', { pointerId: 2, clientX: 110, clientY: 100 }); await settle();
  assert.equal(h.sources.length, 1);
  h.event('pointerup', { pointerId: 1, clientX: 110, clientY: 100 }); h.rebound(); h.protected(false);
  h.window('whale-interaction-geometry'); await settle();
  assert.equal(h.sources.at(-1), '/assets/shenshen-jump.png');
  const count = h.sources.length; h.down(); h.event('pointercancel', { pointerId: 1 }); h.rebound(); h.protected(false);
  h.event('pointerup', { pointerId: 1, clientX: 100, clientY: 100 }); await settle();
  assert.equal(h.sources.length, count);
});

test('desktop status errors preserve working and hidden/custom roles skip polling', async () => {
  const h = desktopHarness(); await settle();
  h.reply({ ok: true, monitor: { activeTurns: 2 } }); await h.intervals[0].fn(); await settle();
  assert.equal(h.sources.at(-1), '/assets/shenshen-working.png');
  h.offline(true); await h.intervals[0].fn(); await settle();
  h.offline(false); h.http(false); await h.intervals[0].fn(); await settle();
  assert.equal(h.sources.at(-1), '/assets/shenshen-working.png');
  const before = h.requests(); h.document.hidden = true; await h.intervals[0].fn();
  h.document.hidden = false; h.window('whale-role-applied', { id: 'custom-cat' }); await h.intervals[0].fn();
  h.window('whale-turn-notice', { id: 'new', completionKind: 'failed' }); await settle();
  assert.equal(h.requests(), before); assert.equal(h.sources.at(-1), '/assets/shenshen-working.png');
  h.http(true); h.reply({ ok: true, monitor: { activeTurns: 0 } });
  h.window('whale-role-applied', { id: 'default' }); await settle();
  assert.equal(h.sources.at(-1), '/assets/shenshen-idle.png');
});

test('a saved custom role never starts default Shenshen art', async () => {
  const h = desktopHarness({ role: 'my-character' }); await settle();
  assert.equal(h.sources.length, 0); assert.equal(h.requests(), 0);
  h.window('beforeunload'); await settle(); assert.equal(h.timers.size, 0);
});

test('reapplying the default role restores its current task animation after the host changes src', async () => {
  const h = desktopHarness(); await settle();
  h.reply({ ok: true, monitor: { activeTurns: 1 } }); await h.intervals[0].fn(); await settle();
  h.pet.src = '/dsh-whale/image.png?v=2'; h.window('whale-role-applied', { id: 'default' }); await settle();
  assert.equal(h.sources.at(-1), '/assets/shenshen-working.png');
});

test('unexpected pointer capture loss cancels the queued gesture reaction', async () => {
  const h = desktopHarness(); await settle(); h.down();
  h.event('lostpointercapture', { pointerId: 1 }); h.rebound(); h.protected(false);
  h.event('pointerup', { pointerId: 1, clientX: 100, clientY: 100 }); await settle();
  assert.deepEqual(h.sources, ['/assets/shenshen-idle.png']);
});

test('the actual host role switch emits its role identity only after image and alpha preparation', async () => {
  const widget = fs.readFileSync(new URL('../assets/whale-widget.js', import.meta.url), 'utf8');
  const start = widget.indexOf('    function applyRole('), end = widget.indexOf('    function roleUrl(', start);
  const decoded = deferred(), alpha = deferred(), events = [], assignments = [];
  const box = vm.createContext({ roleLoadGeneration: 0, currentRole: null, badRoleIds: {}, fallbackInProgress: false,
    Image: class { decode() { return decoded.promise; } },
    WhaleRendering: { hitCache: { prepare: () => alpha.promise }, presentFor() {} },
    img: { set src(value) { assignments.push(value); } }, window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setRoleBtnText() {}, localStorage: { setItem() {} }, setupHitTest() {}, closeRolePanel() {}, renderRolePanel() {},
    assetNotice() {}, recoverBrokenRole() {},
  });
  vm.runInContext(widget.slice(start, end), box);
  const applying = box.applyRole('default', '深深', '/dsh-whale/image.png?v=2');
  decoded.resolve(); await settle(); assert.equal(events.length, 0); assert.equal(assignments.length, 0);
  alpha.resolve(); assert.equal(await applying, true);
  assert.equal(events.length, 1); assert.equal(events[0].type, 'whale-role-applied');
  assert.deepEqual({ ...events[0].detail }, { id: 'default', name: '深深', url: '/dsh-whale/image.png?v=2' });
});

test('desktop loads the controller after input and serves an isolated preview', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shenshen-routes-'));
  const server = createDispatcher({ dataDir: directory, monitor: false, autoRefresh: false,
    service: { config: { publicInfo: () => ({}), resolve: () => ({ setting: { monitorSessions: false } }) }, close: async () => {} },
    fxFetchImpl: async () => new Response(JSON.stringify({ rates: { CNY: 6.7 } })) });
  t.after(async () => { await server.close(); assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); });
  const html = (await server.dispatch('/widget.html')).body.toString();
  assert.ok(html.includes('src="/shenshen-actions.js"'));
  assert.ok(html.indexOf('src="/input.js"') < html.indexOf('src="/shenshen-actions.js"'));
  for (const route of ['/shenshen-actions.js', '/shenshen-preview.html', '/shenshen-preview.js']) assert.equal((await server.dispatch(route)).status, 200);
  const preview = (await server.dispatch('/shenshen-preview.html')).body.toString();
  assert.match(preview, /模拟/); assert.doesNotMatch(preview, /client\.js|dsh-whale\/widget\.js/);
});
