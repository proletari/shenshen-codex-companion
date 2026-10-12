(() => {
  'use strict';
  const { actions, assetUrl, createController } = window.ShenshenActions;
  const pet = document.getElementById('pet'), status = document.getElementById('status');
  const error = document.getElementById('error'), protect = document.getElementById('protect');
  const assetBase = new URL('../../assets/', location.href).href;
  const labels = { idle: '空闲', working: '工作中', thinking: '思考（手动）', celebrate: '庆祝', failed: '排错恢复', wave: '挥手', jump: '跳跃' };
  const decoded = new Map(); let gesture = null, seq = 0;
  function prepare(action) {
    if (!decoded.has(action)) {
      const img = new Image(); img.src = assetUrl(action, assetBase);
      decoded.set(action, img.decode().catch(cause => {
        error.hidden = false; error.textContent = '动作素材读取失败：' + action + '。请先构建素材，再通过本地 HTTP 服务打开预览。';
        throw cause;
      }));
    }
    return decoded.get(action);
  }
  const controller = createController({ prepare,
    isProtected: () => protect.checked || gesture !== null,
    show(action) {
      pet.src = assetUrl(action, assetBase); pet.alt = '深深 · ' + labels[action]; pet.dataset.action = action;
      queueMicrotask(update);
    },
  });
  function update() {
    const state = controller.status();
    status.textContent = '模拟基础状态：' + labels[state.base] + ' · 当前动作：' + (labels[pet.dataset.action] || pet.alt.replace('深深 · ', '')) + (state.queued ? ' · 等待保护结束' : '');
  }
  // Only artwork is fetched; no service endpoints or desktop bridge are loaded.
  for (const action of actions) prepare(action).catch(() => {});
  document.querySelectorAll('[data-monitor]').forEach(button => button.onclick = () => { controller.setMonitor({ activeTurns: Number(button.dataset.monitor) }); update(); });
  document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => { controller.trigger(button.dataset.action); update(); });
  document.querySelectorAll('[data-notice]').forEach(button => button.onclick = () => {
    controller.onNotice({ id: 'preview-' + (++seq), completionKind: button.dataset.notice }); update();
  });
  protect.onchange = () => { controller.flush(); update(); };
  pet.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    pet.setPointerCapture(event.pointerId);
  });
  pet.addEventListener('pointermove', event => {
    if (gesture && event.pointerId === gesture.id && (event.clientX - gesture.x) ** 2 + (event.clientY - gesture.y) ** 2 >= 9) gesture.moved = true;
  });
  pet.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const action = gesture.moved ? 'jump' : 'wave'; gesture = null;
    controller.trigger(action); update();
  });
  pet.addEventListener('pointercancel', () => { gesture = null; controller.flush(); });
  window.addEventListener('beforeunload', controller.dispose);
})();
