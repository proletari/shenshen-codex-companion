import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 隔离用户数据：插件在 import 时读取 DSH_HOME，必须指向临时目录，
// 否则测试会碰真实的 ~/.dsh。
process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shenshen-test-'))

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plugin = (await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)).default

function makeHarness() {
  const handlers = new Map()
  const routes = new Map()
  const injections = []
  const cleanups = []
  let tap = null

  const ctx = {
    on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) },
    effect(fn) { const done = fn(); if (typeof done === 'function') cleanups.push(done); return () => {} },
    get(name) {
      if (name === 'sessionTitle') return null
      if (name === 'deepseekAccount') return { getBalance: async () => null }
      return null
    },
    webServer: {
      register(route) { routes.set(route.path, route); return () => routes.delete(route.path) },
      tapIndex(fn) { tap = fn; return () => { tap = null } },
    },
    credentials: {
      async resolve() { return '' },
      async set() {},
      async delete() {},
    },
    connection: { requestRejection() { return undefined } },
  }

  const rootObj = {
    effect(fn) { const done = fn(); if (typeof done === 'function') cleanups.push(done); return () => {} },
    on(name, fn) {
      if (name === 'webserver/index-inject') {
        const table = []
        fn(table)
        injections.push(...table)
      }
      return () => {}
    },
    inject(services, cb) {
      assert.deepEqual(services, ['webServer', 'credentials', 'connection'])
      cb(ctx)
    },
  }

  plugin.apply(rootObj)
  return { handlers, routes, injections, tap: () => tap, cleanups }
}

function callRoute(route, { url = route.path, method = 'GET' } = {}) {
  const chunks = []
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value) },
    writeHead(code, headers) {
      this.statusCode = code
      if (headers) for (const [key, value] of Object.entries(headers)) this.setHeader(key, value)
      return this
    },
    end(chunk) { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))) },
  }
  const req = { url, method, headers: { host: '127.0.0.1:54823' }, on() {} }
  const result = route.handler(req, res)
  return Promise.resolve(result).then(() => ({
    status: res.statusCode,
    headers: res.headers,
    body: Buffer.concat(chunks),
  }))
}

test('plugin manifest points at an existing host entry and bundle patch', () => {
  assert.equal(plugin.name, 'shenshen-companion')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.main, 'lib/index.js')
  assert.ok(pkg.dsh.bundle.patch)
  assert.ok(fs.existsSync(path.join(root, pkg.dsh.bundle.patch)))
  assert.ok(fs.existsSync(path.join(root, pkg.main)))
})

test('desktop injection table gets both widget.js and shenshen-actions.js rows', () => {
  const h = makeHarness()
  assert.equal(h.injections.length, 2)
  const texts = h.injections.map((row) => row.text).join('\n')
  assert.match(texts, /\/dsh-whale\/widget\.js/)
  assert.match(texts, /\/dsh-whale\/shenshen-actions\.js/)
  assert.ok(h.injections.every((row) => row.kind === 'script' && row.placement === 'body'))
})

test('web tapIndex injects both scripts and stays idempotent', () => {
  const h = makeHarness()
  const once = h.tap()('<!doctype html><html><body><div id="app"></div></body></html>')
  assert.match(once, /widget\.js/)
  assert.match(once, /shenshen-actions\.js/)
  const twice = h.tap()(once)
  assert.equal(twice, once)
})

test('shenshen-status.json reflects turn events and notices', async () => {
  const h = makeHarness()
  const route = h.routes.get('/dsh-whale/shenshen-status.json')
  assert.ok(route, 'status route is registered')

  let payload = JSON.parse((await callRoute(route)).body.toString('utf8'))
  assert.equal(payload.ok, true)
  assert.equal(payload.activeTurns, 0)

  h.handlers.get('session/event')({ id: 's1' }, { type: 'turn/start', data: {} })
  payload = JSON.parse((await callRoute(route)).body.toString('utf8'))
  assert.equal(payload.activeTurns, 1)

  h.handlers.get('session/event')({ id: 's1' }, { type: 'turn/end', data: { reason: 'completed' } })
  payload = JSON.parse((await callRoute(route)).body.toString('utf8'))
  assert.equal(payload.activeTurns, 0)
  assert.equal(payload.notice.kind, 'success')
  assert.equal(payload.notice.id, 1)

  h.handlers.get('session/disposed')({ id: 's1' })
})

test('shenshen image and actions routes serve the real assets', async () => {
  const h = makeHarness()
  const image = h.routes.get('/dsh-whale/shenshen-image.png')
  const ok = await callRoute(image, { url: '/dsh-whale/shenshen-image.png?name=shenshen-idle.png' })
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['content-type'], 'image/png')
  assert.equal(ok.body.readUInt32BE(0), 0x89504e47)
  assert.ok(ok.body.length > 1_000_000)

  const bad = await callRoute(image, { url: '/dsh-whale/shenshen-image.png?name=../../package.json' })
  assert.equal(bad.status, 404)

  // 拖拽循环与全帧掩膜也必须落在白名单里，否则运行期会 404 退回旧轮廓。
  for (const name of ['shenshen-runright.png', 'shenshen-maskrunright.png', 'shenshen-maskidle.png', 'shenshen-maskworking.png']) {
    const res = await callRoute(image, { url: '/dsh-whale/shenshen-image.png?name=' + name })
    assert.equal(res.status, 200, name + ' is served')
    assert.equal(res.body.readUInt32BE(0), 0x89504e47)
  }

  const actions = h.routes.get('/dsh-whale/shenshen-actions.js')
  const js = await callRoute(actions)
  assert.equal(js.status, 200)
  assert.match(js.body.toString('utf8'), /createController/)
  assert.match(js.body.toString('utf8'), /dsh-whale\/shenshen-status\.json/)
})

test('the plugin still keeps its upstream routes intact', () => {
  const h = makeHarness()
  for (const route of ['/dsh-whale/image.png', '/dsh-whale/balance.json', '/dsh-whale/roles.json', '/dsh-whale/bubble.json']) {
    assert.ok(h.routes.has(route), route + ' is still served')
  }
})
