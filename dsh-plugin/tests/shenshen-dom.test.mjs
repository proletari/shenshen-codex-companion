// 事件层回归：用最小假 DOM 跑真实的 shenshen-actions.js，验证「点击/拖动之后不会卡在某个动作」。
// 只模拟 sidecar 用到的 DOM 子集，不引入 jsdom。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const source = fs.readFileSync(fileURLToPath(new URL('../assets/shenshen-actions.js', import.meta.url)), 'utf8')
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

function createWorld(initialSrc = '/dsh-whale/image.png') {
  const documentHandlers = new Map()
  const windowHandlers = new Map()
  const observers = []
  const intervals = []
  const hitCalls = []

  function listen(map, type, fn) {
    if (!map.has(type)) map.set(type, [])
    map.get(type).push(fn)
  }
  function notify(target) {
    for (const observer of observers) {
      if (observer.target !== target) continue
      queueMicrotask(() => { try { observer.callback([]) } catch (err) {} })
    }
  }

  const classes = new Set()
  const root = {
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => { classes.add(name); notify(root) },
      remove: (name) => { classes.delete(name); notify(root) },
    },
    contains: () => true,
    addEventListener() {},
  }

  const attributes = { src: initialSrc }
  const img = {
    style: {},
    dataset: {},
    alt: '',
    currentSrc: initialSrc,
    _src: initialSrc,
    get src() { return this._src },
    set src(value) {
      this._src = String(value)
      this.currentSrc = String(value)
      attributes.src = String(value)
      notify(img)
    },
    getAttribute(name) { return attributes[name] ?? null },
    setAttribute(name, value) { attributes[name] = String(value); notify(img) },
    closest(selector) { return selector === '.dshwv-img' ? img : null },
    contains() { return true },
    isConnected: true,
    addEventListener() {},
  }

  const document = {
    hidden: false,
    readyState: 'complete',
    querySelector(selector) {
      if (selector === '.dshwv-img') return img
      if (selector === '.dshwv-root') return root
      return null
    },
    addEventListener(type, fn) { listen(documentHandlers, type, fn) },
    removeEventListener() {},
  }

  const window = {
    addEventListener(type, fn) { listen(windowHandlers, type, fn) },
    __dshwvShenshenHit(url) { hitCalls.push(url) },
    __dshwvShenshenClearHit() {},
  }

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.target = null }
    observe(target) { this.target = target; observers.push(this) }
    disconnect() {
      const index = observers.indexOf(this)
      if (index >= 0) observers.splice(index, 1)
    }
  }
  class FakeImage {
    constructor() { this.src = '' }
    decode() { return Promise.resolve() }
  }

  const context = {
    window,
    document,
    location: { href: 'http://127.0.0.1:60054/' },
    Image: FakeImage,
    MutationObserver: FakeMutationObserver,
    fetch: async () => ({
      ok: true,
      async json() { return { ok: true, activeTurns: 0, waiting: false, notice: null } },
    }),
    setTimeout,
    clearTimeout,
    setInterval(fn) { intervals.push(fn); return intervals.length },
    clearInterval() {},
    URL,
    encodeURIComponent,
    queueMicrotask,
    console,
  }

  vm.runInNewContext(source, context, { filename: 'shenshen-actions.js' })
  intervals[0]() // boot 的 500ms 轮询：此刻 .dshwv-img 已存在 → setup()

  function event(overrides = {}) {
    return {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      buttons: 1,
      target: img,
      composedPath: () => [img],
      preventDefault() {},
      stopPropagation() {},
      ...overrides,
    }
  }

  function emit(type, overrides) {
    const ev = event(overrides)
    for (const fn of documentHandlers.get(type) || []) fn(ev)
    if (!documentHandlers.has(type)) for (const fn of windowHandlers.get(type) || []) fn(ev)
    return ev
  }

  return {
    img,
    root,
    classes,
    hitCalls,
    event,
    emit,
    down: (extra) => emit('pointerdown', extra),
    move: (extra) => emit('pointermove', extra),
    up: (extra) => emit('pointerup', extra),
    addDragClass: () => { classes.add('dshwv-dragging'); notify(root) },
    removeDragClass: () => { classes.delete('dshwv-dragging'); notify(root) },
  }
}

test('click: pointerup → host removes drag class → wave plays, then returns to idle', async () => {
  const w = createWorld()
  w.down()
  w.addDragClass()
  await settle()
  w.up()
  w.removeDragClass()
  await settle(10)
  assert.match(w.img.src, /shenshen-wave\.png/)
  await settle(1200)
  assert.match(w.img.src, /shenshen-idle\.png/)
})

test('drag right: moving enters the right-running loop; release jumps and returns to idle', async () => {
  const w = createWorld()
  w.down()
  w.addDragClass()
  w.move({ clientX: 130, clientY: 130, buttons: 1 })
  await settle(10)
  assert.match(w.img.src, /shenshen-runright\.png/)
  w.up({ clientX: 130, clientY: 130 })
  w.removeDragClass()
  await settle(10)
  assert.match(w.img.src, /shenshen-jump\.png/)
  await settle(1200)
  assert.match(w.img.src, /shenshen-idle\.png/)
})

test('drag left: dragging left uses the mirrored running loop', async () => {
  const w = createWorld()
  w.down()
  w.addDragClass()
  w.move({ clientX: 70, clientY: 100, buttons: 1 })
  await settle(10)
  assert.match(w.img.src, /shenshen-runleft\.png/)
  w.up({ clientX: 70, clientY: 100 })
  w.removeDragClass()
  await settle(10)
  assert.match(w.img.src, /shenshen-jump\.png/)
})

test('lost pointerup: a pointermove with buttons=0 still finishes the drag', async () => {
  const w = createWorld()
  w.down()
  w.addDragClass()
  w.move({ clientX: 140, clientY: 140, buttons: 1 })
  await settle(10)
  assert.match(w.img.src, /shenshen-runright\.png/)
  // 模拟 pointerup 丢失：下一次 move 的 buttons 已经是 0
  w.move({ clientX: 141, clientY: 141, buttons: 0 })
  w.removeDragClass()
  await settle(10)
  assert.match(w.img.src, /shenshen-jump\.png/)
  await settle(1200)
  assert.match(w.img.src, /shenshen-idle\.png/)
})

test('if the host keeps the drag class, the 400ms fallback still ends the drag state', async () => {
  const w = createWorld()
  w.down()
  w.addDragClass()
  w.move({ clientX: 150, clientY: 150, buttons: 1 })
  await settle(10)
  assert.match(w.img.src, /shenshen-runright\.png/)
  w.up({ clientX: 150, clientY: 150 })
  // 故意不摘 .dshwv-dragging，模拟宿主丢事件
  await settle(450)
  assert.match(w.img.src, /shenshen-jump\.png/)
})

test('when the widget is mirrored (docked left), drag direction is compensated', async () => {
  const w = createWorld()
  w.root.classList.add('dshwv-left') // 宿主停靠左侧时会镜像整个 root
  w.down()
  w.addDragClass()
  w.move({ clientX: 130, clientY: 100, buttons: 1 }) // 向右拖
  await settle(10)
  // 镜像后 runleft 视觉上朝右 → 用 left 图
  assert.match(w.img.src, /shenshen-runleft\.png/)
})

test('dragging left then right reverses the run direction immediately', async () => {
  const w = createWorld()
  w.down()
  w.addDragClass()
  w.move({ clientX: 60, clientY: 100, buttons: 1 }) // 先向左 40px
  await settle(10)
  assert.match(w.img.src, /shenshen-runleft\.png/)
  w.move({ clientX: 80, clientY: 100, buttons: 1 }) // 再向右 20px
  await settle(10)
  assert.match(w.img.src, /shenshen-runright\.png/)
})

test('each action sets a precomputed clip polygon instead of relying on host hulls', async () => {
  const w = createWorld()
  w.down()
  w.addDragClass()
  w.move({ clientX: 130, clientY: 100, buttons: 1 })
  await settle(10)
  assert.match(w.img.style.clipPath, /^polygon\(/)
  const dragClip = w.img.style.clipPath
  w.up({ clientX: 130, clientY: 100 })
  w.removeDragClass()
  await settle(10)
  assert.match(w.img.style.clipPath, /^polygon\(/)
  assert.notEqual(w.img.style.clipPath, dragClip)
})

test('clicking again during wave restarts cleanly instead of leaving a stale timer', async () => {
  const w = createWorld()
  w.down(); w.addDragClass(); await settle(); w.up(); w.removeDragClass()
  await settle(10)
  assert.match(w.img.src, /shenshen-wave\.png/)
  w.down(); w.addDragClass(); await settle(); w.up(); w.removeDragClass()
  await settle(10)
  assert.match(w.img.src, /shenshen-wave\.png/)
  await settle(1200)
  assert.match(w.img.src, /shenshen-idle\.png/)
})
