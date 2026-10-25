import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const sourceFile = fileURLToPath(new URL('../assets/shenshen-actions.js', import.meta.url))
const source = fs.readFileSync(sourceFile, 'utf8')
const manifest = JSON.parse(fs.readFileSync(new URL('../assets/shenshen-manifest.json', import.meta.url), 'utf8'))
const settle = () => new Promise((resolve) => setImmediate(resolve))

function harness() {
  const store = new Map()
  const window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  }
  const timers = new Map()
  let serial = 0
  vm.runInNewContext(source, { window, setTimeout, clearTimeout, console }, { filename: sourceFile })
  const api = window.ShenshenActions
  const shown = []
  const prepared = []
  let protectedNow = false
  const controller = api.createController({
    show: (action) => shown.push(action),
    prepare: async (action) => { prepared.push(action) },
    isProtected: () => protectedNow,
    schedule: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id },
    cancel: (id) => timers.delete(id),
  })
  return {
    api, controller, shown, prepared, timers, store,
    protect: (value) => { protectedNow = value },
    expire() { const [id, timer] = [...timers].at(-1); timers.delete(id); timer.fn() },
  }
}

test('the seven actions map to the plugin asset route', () => {
  const h = harness()
  assert.deepEqual(Array.from(h.api.actions), ['idle', 'working', 'thinking', 'celebrate', 'failed', 'wave', 'jump'])
  const urls = h.api.actions.map((action) => h.api.assetUrl(action))
  assert.equal(new Set(urls).size, 7)
  for (const action of h.api.actions) {
    assert.match(h.api.assetUrl(action), new RegExp('^/dsh-whale/shenshen-image\\.png\\?name=shenshen-' + action + '\\.png&v=\\d+$'))
  }
  assert.throws(() => h.api.assetUrl('__proto__'), /Unknown/)
})

test('every action APNG exists, decodes as 6-frame APNG, and durations match the manifest', () => {
  assert.equal(Object.keys(manifest.states).length, 7)
  const h = harness()
  for (const action of ['idle', 'working', 'thinking', 'celebrate', 'failed', 'wave', 'jump']) {
    const spec = manifest.states[action]
    assert.equal(spec.frameCount, 6)
    assert.equal(spec.uniqueFrames, 6)
    const bytes = fs.readFileSync(new URL('../assets/' + spec.file, import.meta.url))
    assert.equal(bytes.readUInt32BE(0), 0x89504e47, action + ' is a PNG')
    let frames = 0
    let acTL = 0
    for (let offset = 8; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset)
      const type = bytes.toString('ascii', offset + 4, offset + 8)
      if (type === 'acTL') acTL = bytes.readUInt32BE(offset + 8)
      if (type === 'fcTL') frames += 1
      offset += size + 12
    }
    assert.equal(acTL, 6, action + ' advertises six APNG frames')
    assert.equal(frames, 6, action + ' has six frame control chunks')
  }
  for (const [action, duration] of Object.entries(h.api.durations)) {
    const total = manifest.states[action].durationMs.reduce((sum, value) => sum + value, 0)
    assert.equal(total, duration, action + ' controller duration matches the manifest')
  }
  assert.equal(manifest.width, 608)
  assert.equal(manifest.height, 608)
})

test('activeTurns drives working and idle', async () => {
  const h = harness()
  await settle()
  h.controller.setStatus({ activeTurns: 2, waiting: false })
  await settle()
  assert.equal(h.controller.status().base, 'working')
  h.controller.setStatus({ activeTurns: 0, waiting: false })
  await settle()
  assert.equal(h.controller.status().base, 'idle')
})

test('waiting for user input switches to thinking and back', async () => {
  const h = harness()
  h.controller.setStatus({ activeTurns: 1, waiting: true })
  await settle()
  assert.equal(h.controller.status().base, 'thinking')
  h.controller.setStatus({ activeTurns: 1, waiting: false })
  await settle()
  assert.equal(h.controller.status().base, 'working')
})

test('a success notice celebrates once, then returns to the base state', async () => {
  const h = harness()
  h.controller.setStatus({ activeTurns: 0, waiting: false })
  await settle()
  assert.equal(h.controller.onNotice({ id: 'dsh-1', completionKind: 'success' }), true)
  await settle()
  assert.equal(h.controller.status().current, 'celebrate')
  assert.equal(h.controller.onNotice({ id: 'dsh-1', completionKind: 'success' }), false)
  h.expire()
  await settle()
  assert.equal(h.controller.status().current, 'idle')
})

test('a cancelled notice clears the transient instead of playing success', async () => {
  const h = harness()
  h.controller.trigger('wave')
  await settle()
  assert.equal(h.controller.status().current, 'wave')
  h.controller.onNotice({ id: 'dsh-2', completionKind: 'cancelled' })
  await settle()
  assert.equal(h.controller.status().current, 'idle')
})

test('no image swap happens while the host is dragging; it flushes afterwards', async () => {
  const h = harness()
  await settle()
  h.protect(true)
  h.controller.setStatus({ activeTurns: 3, waiting: false })
  await settle()
  assert.notEqual(h.controller.status().current, 'working')
  h.protect(false)
  h.controller.flush()
  await settle()
  assert.equal(h.controller.status().current, 'working')
})

test('dragging switches to the directional run loop even while the host protects the pet', async () => {
  const h = harness()
  h.protect(true)
  h.controller.setDragging(true, 'right')
  await settle()
  assert.equal(h.controller.status().dragging, true)
  assert.equal(h.controller.status().current, 'runright')
  h.controller.setDragging(true, 'left')
  await settle()
  assert.equal(h.controller.status().current, 'runleft')
  h.protect(false)
  h.controller.setDragging(false)
  await settle()
  assert.equal(h.controller.status().current, 'idle')
})

test('run atlases are real 8-frame APNGs with union masks', () => {
  for (const name of ['runright', 'runleft']) {
    const bytes = fs.readFileSync(new URL('../assets/shenshen-' + name + '.png', import.meta.url))
    assert.equal(bytes.readUInt32BE(0), 0x89504e47)
    let acTL = 0, frames = 0
    for (let offset = 8; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset)
      const type = bytes.toString('ascii', offset + 4, offset + 8)
      if (type === 'acTL') acTL = bytes.readUInt32BE(offset + 8)
      if (type === 'fcTL') frames += 1
      offset += size + 12
    }
    assert.equal(acTL, 8, name + ' advertises eight frames')
    assert.equal(frames, 8, name + ' has eight frame controls')
    const mask = fs.readFileSync(new URL('../assets/shenshen-mask' + name + '.png', import.meta.url))
    assert.equal(mask.readUInt32BE(0), 0x89504e47)
  }
})

test('a transient that finishes while the host protects the pet is recovered by a later flush', async () => {
  const h = harness()
  h.controller.trigger('wave')
  await settle()
  assert.equal(h.controller.status().current, 'wave')
  h.protect(true)
  h.expire() // 计时器在保护期到点：cannot switch yet
  await settle()
  assert.equal(h.controller.status().current, 'wave')
  h.protect(false)
  h.controller.flush() // 宿主摘掉拖拽类后的补 flush
  await settle()
  assert.equal(h.controller.status().current, 'idle')
})

test('refresh re-applies the desired action after the host overrides the image', async () => {
  const h = harness()
  h.controller.setStatus({ activeTurns: 1, waiting: false })
  await settle()
  assert.equal(h.controller.status().current, 'working')
  const before = h.shown.length
  h.controller.refresh() // 宿主把 img.src 改成别的图后，强制重画
  await settle()
  assert.ok(h.shown.length > before)
  assert.equal(h.controller.status().current, 'working')
})

test('a handled notice survives a page reload without replaying', async () => {
  const h = harness()
  assert.equal(h.controller.onNotice({ id: 'dsh-9-123', completionKind: 'success' }), true)
  await settle()
  // 模拟刷新：同一 localStorage 上新建 controller
  const reloaded = h.api.createController({ show: () => {}, prepare: async () => {} })
  assert.equal(reloaded.onNotice({ id: 'dsh-9-123', completionKind: 'success' }), false)
})

test('every action ships a precomputed clip polygon and working is wider than idle', () => {
  const h = harness()
  const clips = h.api.clips
  assert.deepEqual(Object.keys(clips).sort(), ['celebrate', 'failed', 'idle', 'jump', 'runleft', 'runright', 'thinking', 'wave', 'working'])
  const xs = (poly) => [...poly.matchAll(/([\d.]+)%\s+([\d.]+)%/g)].map((m) => Number(m[1]))
  for (const poly of Object.values(clips)) {
    assert.match(poly, /^polygon\(/)
    assert.ok((poly.match(/%/g) || []).length >= 6)
    assert.ok(Math.max(...xs(poly)) <= 100 && Math.min(...xs(poly)) >= 0)
  }
  const width = (poly) => Math.max(...xs(poly)) - Math.min(...xs(poly))
  assert.ok(width(clips.working) > width(clips.idle), 'working clip must be wider than idle')
})

test('dispose stops every pending timer', async () => {
  const h = harness()
  h.controller.trigger('failed')
  await settle()
  h.controller.dispose()
  assert.equal(h.timers.size, 0)
  assert.equal(h.controller.status().enabled, false)
})
