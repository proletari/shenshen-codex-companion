// 深深动作状态的纯逻辑层：把 DSH 的 session/event 折叠成
// { activeTurns, waiting, notice }，供 /dsh-whale/shenshen-status.json 输出。
//
// 保持无副作用、无依赖，方便单测（tests/shenshen-state.test.mjs）。

const FAILURE_RE = /(error|fail)/;
const CANCEL_RE = /(abort|cancel|interrupt|superseded)/;

function reasonOf(data) {
  const d = data || {};
  // turn/end 的 reason 字段在不同 DSH 版本上可能叫 reason / status / outcome。
  for (const key of ['reason', 'status', 'outcome', 'result']) {
    const value = d[key];
    if (typeof value === 'string' && value) return value.toLowerCase();
  }
  return '';
}

function kindOf(reason) {
  if (FAILURE_RE.test(reason)) return 'failed';
  if (CANCEL_RE.test(reason)) return 'cancelled';
  return 'success';
}

/**
 * @param {object} options
 * @param {(sid: string) => boolean} [options.isSubagent] 子代理会话不触发完成动画
 * @param {number} [options.ttlMs] 兜底清理：turn/end 丢失时不至于永远"工作中"
 * @param {() => number} [options.now]
 */
export function createShenshenTracker({ isSubagent = () => false, ttlMs = 15 * 60 * 1000, now = Date.now } = {}) {
  /** @type {Map<string, number>} sessionId -> lastActivity */
  const active = new Map();
  let notice = null;
  let seq = 0;

  function touch(sid, at) {
    active.set(sid, at);
  }

  function note(sid, event) {
    const type = event && event.type;
    if (typeof type !== 'string' || !type) return;
    const at = now();
    const data = (event && event.data) || {};

    if (type === 'turn/start') {
      touch(sid, at);
      return;
    }
    // DSH 每个模型步骤都会追加 assistant/message；即使某些版本没有 turn/start，
    // 也能据此把会话标记为"工作中"。
    if (type === 'assistant/message') {
      touch(sid, at);
      return;
    }
    if (type === 'tool/call' || type === 'tool/result' || type === 'approval/asked') {
      if (active.has(sid)) touch(sid, at);
      return;
    }
    if (type === 'turn/end') {
      active.delete(sid);
      if (isSubagent(sid)) return;
      const kind = kindOf(reasonOf(data));
      seq += 1;
      notice = { id: seq, kind, at };
    }
  }

  function prune(at = now()) {
    for (const [sid, ts] of active) {
      if (!Number.isFinite(ts) || at - ts > ttlMs) active.delete(sid);
    }
  }

  function status(extra = {}) {
    prune();
    return {
      ok: true,
      activeTurns: active.size,
      waiting: false,
      notice,
      now: now(),
      ...extra,
    };
  }

  function reset() {
    active.clear();
    notice = null;
    seq = 0;
  }

  function forget(sid) {
    if (sid != null) active.delete(String(sid));
  }

  return { note, forget, status, reset, snapshot: () => ({ activeTurns: active.size, notice }) };
}
