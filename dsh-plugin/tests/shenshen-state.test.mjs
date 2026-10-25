import test from 'node:test'
import assert from 'node:assert/strict'
import { createShenshenTracker } from '../lib/shenshen-state.mjs'

test('turn/start → turn/end folds into activeTurns and a single success notice', () => {
  const tracker = createShenshenTracker({ now: () => 1000 })
  assert.deepEqual(tracker.status(), {
    ok: true, activeTurns: 0, waiting: false, notice: null, now: 1000,
  })

  tracker.note('s1', { type: 'turn/start', data: {} })
  assert.equal(tracker.status().activeTurns, 1)

  tracker.note('s1', { type: 'turn/end', data: { reason: 'completed' } })
  const status = tracker.status()
  assert.equal(status.activeTurns, 0)
  assert.equal(status.notice.kind, 'success')
  assert.equal(status.notice.id, 1)
})

test('aborted turns are cancelled and never celebrate', () => {
  const tracker = createShenshenTracker({ now: () => 1 })
  tracker.note('s1', { type: 'turn/start', data: {} })
  tracker.note('s1', { type: 'turn/end', data: { status: 'aborted' } })
  assert.equal(tracker.status().notice.kind, 'cancelled')
})

test('error turns are failed', () => {
  const tracker = createShenshenTracker({ now: () => 1 })
  tracker.note('s1', { type: 'turn/start', data: {} })
  tracker.note('s1', { type: 'turn/end', data: { reason: 'agent_error' } })
  assert.equal(tracker.status().notice.kind, 'failed')
})

test('assistant/message alone marks a session active (no turn/start fallback)', () => {
  const tracker = createShenshenTracker({ now: () => 1 })
  tracker.note('s1', { type: 'assistant/message', data: {} })
  assert.equal(tracker.status().activeTurns, 1)
})

test('subagent sessions never raise completion notices', () => {
  const tracker = createShenshenTracker({ now: () => 1, isSubagent: (sid) => sid === 'sub' })
  tracker.note('sub', { type: 'turn/start', data: {} })
  tracker.note('sub', { type: 'turn/end', data: { reason: 'completed' } })
  assert.equal(tracker.status().notice, null)
  assert.equal(tracker.status().activeTurns, 0)
})

test('stale sessions are pruned after the ttl so a lost turn/end cannot stick forever', () => {
  let clock = 0
  const tracker = createShenshenTracker({ now: () => clock, ttlMs: 1000 })
  tracker.note('s1', { type: 'turn/start', data: {} })
  clock = 500
  assert.equal(tracker.status().activeTurns, 1)
  clock = 1500
  assert.equal(tracker.status().activeTurns, 0)
})

test('forget drops a disposed session immediately', () => {
  const tracker = createShenshenTracker({ now: () => 1 })
  tracker.note('s1', { type: 'turn/start', data: {} })
  tracker.forget('s1')
  assert.equal(tracker.status().activeTurns, 0)
})

test('unknown event types do not change state', () => {
  const tracker = createShenshenTracker({ now: () => 1 })
  tracker.note('s1', { type: 'session/title', data: { title: 'x' } })
  tracker.note('s1', { type: 'turn/end', data: { reason: 'completed' } })
  const status = tracker.status()
  assert.equal(status.activeTurns, 0)
  assert.equal(status.notice.kind, 'success') // 没有活动轮次也允许结算通知
})
