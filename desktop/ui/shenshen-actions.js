(() => {
  'use strict';
  const actions = Object.freeze(['idle', 'working', 'thinking', 'celebrate', 'failed', 'wave', 'jump']);
  const durations = { thinking: 1460, celebrate: 1070, failed: 1550, wave: 1070, jump: 1050 };
  function assetUrl(action, base = '/assets') {
    if (!actions.includes(action)) throw new TypeError('Unknown Shenshen action');
    return base.replace(/\/$/, '') + '/shenshen-' + action + '.png';
  }

  // A transient starts its deadline only after its image is safely presented.
  // Monitor updates during that animation still determine the return state.
  function createController({ show, prepare = async () => {}, isProtected = () => false,
    schedule = setTimeout, cancel = clearTimeout }) {
    let enabled = true, disposed = false, base = 'idle', current = null;
    let transient = null, timer = null, generation = 0, loading = null, lastNoticeId = '';
    const failed = new Set();
    const desired = () => transient?.action || base;
    const stopTimer = () => { if (timer !== null) cancel(timer); timer = null; };
    function invalidate() { ++generation; loading = null; }
    function arm() {
      if (!transient || timer !== null) return;
      const item = transient;
      timer = schedule(() => {
        if (disposed || transient !== item) return;
        timer = null; transient = null; invalidate(); sync();
      }, durations[item.action]);
    }
    function sync() {
      if (!enabled || disposed || isProtected()) return;
      const action = desired();
      if (current === action) { arm(); return; }
      if (failed.has(action) || loading?.action === action) return;
      const token = ++generation;
      loading = { action, token };
      Promise.resolve().then(() => prepare(action)).then(() => {
        if (!enabled || disposed || generation !== token || desired() !== action) return;
        loading = null;
        // A press may have started while decoding the image or its alpha mask.
        if (isProtected()) return;
        show(action); current = action; arm();
      }).catch(() => {
        if (generation !== token || disposed) return;
        loading = null; failed.add(action);
        if (transient?.action === action) { transient = null; invalidate(); sync(); }
      });
    }
    function trigger(action) {
      if (!enabled || disposed || !Object.hasOwn(durations, action)) return false;
      stopTimer(); transient = { action }; invalidate(); sync(); return true;
    }
    const controller = {
      setMonitor(monitor) {
        const turns = monitor?.activeTurns;
        if (disposed || typeof turns !== 'number' || !Number.isFinite(turns) || turns < 0) return;
        const next = turns > 0 ? 'working' : 'idle';
        if (next === base) return;
        base = next; if (!transient) invalidate(); sync();
      },
      onNotice(notice) {
        if (!enabled || disposed || !['success', 'failed', 'cancelled'].includes(notice?.completionKind)) return false;
        if (notice.id && notice.id === lastNoticeId) return false;
        if (notice.id) lastNoticeId = notice.id;
        if (notice.completionKind === 'cancelled') {
          stopTimer(); transient = null; invalidate(); sync(); return true;
        }
        return trigger(notice.completionKind === 'success' ? 'celebrate' : 'failed');
      },
      trigger,
      setEnabled(value) {
        if (disposed || enabled === !!value) return;
        enabled = !!value; stopTimer(); transient = null; current = null; invalidate(); sync();
      },
      flush: sync,
      status: () => ({ enabled, base, current, queued: enabled && desired() !== current ? desired() : null }),
      dispose() { disposed = true; enabled = false; stopTimer(); transient = null; invalidate(); },
    };
    sync(); return controller;
  }
  window.ShenshenActions = Object.freeze({ actions, assetUrl, createController });

  // The separate preview uses the same controller without the desktop bridge.
  if (!window.whaleDesktop || !window.WhaleRendering) return;
  const pet = document.querySelector('.dshwv-img'), root = document.querySelector('.dshwv-root');
  if (!pet || !root) return;
  const rendering = window.WhaleRendering, decoded = new Map();
  let gesture = null, polling = false;
  function prepare(action) {
    const url = assetUrl(action);
    if (!decoded.has(url)) {
      const image = new Image(); image.src = url;
      decoded.set(url, image.decode());
    }
    // A custom role can evict an old alpha entry, so always touch the live cache.
    return Promise.all([decoded.get(url), rendering.hitCache.prepare(url)]);
  }
  const controller = createController({
    prepare,
    isProtected: () => root.classList.contains('dshwv-dragging') || !!rendering.petInteraction?.protectedBounds(pet, root),
    show(action) {
      pet.src = assetUrl(action); pet.alt = '深深'; pet.dataset.shenshenAction = action;
      rendering.presentFor(200);
    },
  });
  function preload() { for (const action of actions) prepare(action).catch(() => {}); }
  let savedRole = 'default';
  try { savedRole = localStorage.getItem('dshw-role') || 'default'; } catch {}
  controller.setEnabled(savedRole === 'default');
  if (savedRole === 'default') preload();
  async function poll() {
    if (polling || document.hidden || !controller.status().enabled) return;
    polling = true;
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (data.ok) controller.setMonitor(data.monitor);
    } catch {} finally { polling = false; }
  }
  window.addEventListener('whale-role-applied', event => {
    // applyRole has replaced src even if the same default role was reselected.
    gesture = null; controller.setEnabled(false); controller.setEnabled(event.detail?.id === 'default');
    if (controller.status().enabled) { preload(); poll(); }
  });
  window.addEventListener('whale-turn-notice', event => controller.onNotice(event.detail));
  window.addEventListener('whale-interaction-geometry', controller.flush);
  new MutationObserver(controller.flush).observe(root, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('pointerdown', event => {
    if (!controller.status().enabled || !root.classList.contains('dshwv-dragging') ||
        !rendering.petInteraction?.holding()) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }, true);
  document.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if ((event.clientX - gesture.x) ** 2 + (event.clientY - gesture.y) ** 2 >= 9) gesture.moved = true;
  }, true);
  document.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const action = gesture.moved ? 'jump' : 'wave'; gesture = null;
    controller.trigger(action);
  }, true);
  const cancelGesture = () => { gesture = null; };
  document.addEventListener('pointercancel', cancelGesture, true);
  document.addEventListener('lostpointercapture', event => {
    if (gesture?.id === event.pointerId) cancelGesture();
  }, true);
  window.addEventListener('blur', cancelGesture);
  window.addEventListener('whale-mode-changing', cancelGesture);
  window.addEventListener('whale-desktop-mode', cancelGesture);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelGesture(); else poll(); });
  const interval = setInterval(poll, 3000);
  window.addEventListener('beforeunload', () => { clearInterval(interval); controller.dispose(); });
  poll();
})();
