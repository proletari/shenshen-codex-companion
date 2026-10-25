// 深深动作控制器（DSH 版）
// ---------------------------------------------------------------------------
// 由 dsh-shenshen-companion 的 lib/index.js 以 <script> 注入，运行在 DSH Web/桌面页面里。
//
// 职责：
//   1. 把 .dshwv-img 的 src 切换到 7 组透明 APNG（idle / working / thinking /
//      celebrate / failed / wave / jump），拖动时切到左右两向的 8 帧奔跑；
//   2. 轮询 /dsh-whale/shenshen-status.json 拿到 { activeTurns, waiting, notice }，
//      决定基础状态与完成/失败动画；
//   3. 监听角色切换：用户选自定义角色时自动让位，切回默认角色后恢复；
//   4. 点击挥手、拖动奔跑、松手小跳，并在宿主拖拽/按压期间避免换图。
//
// 不修改 dsh-whale-widget 的 widget.js：通过 DOM 观察与同一个 .dshwv-img 协作。
(() => {
  'use strict'

  const ACTIONS = Object.freeze(['idle', 'working', 'thinking', 'celebrate', 'failed', 'wave', 'jump'])
  const LABELS = { idle: '待机', working: '工作中', thinking: '思考', celebrate: '完成', failed: '失败', wave: '挥手', jump: '跳跃', runright: '奔跑', runleft: '奔跑' }
  // 与 assets/shenshen-manifest.json 对齐；只有短动作需要计时。
  const DURATIONS = { thinking: 1460, celebrate: 1070, failed: 1550, wave: 1070, jump: 1050 }
  const IMAGE_PATH = '/dsh-whale/shenshen-image.png'
  const STATUS_PATH = '/dsh-whale/shenshen-status.json'
  // 资源版本：图片路由带 max-age，用查询参数避开旧缓存（改素材时递增）。
  const ASSET_VERSION = '4'
  // 拖拽态：使用 Codex 自定义宠物 shenshen-orange-codex 的 8 帧跑步图集（左右两向）。
  function runUrl(direction) {
    return IMAGE_PATH + '?name=' + encodeURIComponent('shenshen-run' + direction + '.png') + '&v=' + ASSET_VERSION
  }

  function assetUrl(action) {
    if (!ACTIONS.includes(action)) throw new TypeError('Unknown Shenshen action')
    return IMAGE_PATH + '?name=' + encodeURIComponent('shenshen-' + action + '.png') + '&v=' + ASSET_VERSION
  }

  function urlFor(action) {
    if (action === 'runright') return runUrl('right')
    if (action === 'runleft') return runUrl('left')
    return assetUrl(action)
  }

  // 每个动作有一张「全部帧的 alpha 并集」掩膜：宿主的命中凸包与 clip-path 都按它算，
  // 这样循环里手臂/腿摆出轮廓也不会被裁掉。
  function maskUrlFor(action) {
    return IMAGE_PATH + '?name=' + encodeURIComponent('shenshen-mask' + action + '.png') + '&v=' + ASSET_VERSION
  }

  const CLIP_POLYGONS = {
    idle: 'polygon(18.36% 29.44%, 20.00% 15.62%, 20.42% 14.64%, 20.83% 14.31%, 22.06% 13.82%, 22.88% 13.65%, 23.91% 13.49%, 45.29% 10.53%, 47.76% 10.20%, 49.81% 10.03%, 51.46% 10.03%, 53.72% 10.20%, 55.57% 10.36%, 77.16% 13.16%, 78.39% 13.32%, 79.21% 13.49%, 79.63% 13.65%, 80.04% 13.98%, 80.45% 14.47%, 80.65% 14.80%, 81.48% 34.87%, 81.48% 37.01%, 73.25% 72.04%, 69.35% 86.02%, 69.14% 86.68%, 68.73% 87.34%, 67.91% 87.99%, 67.08% 88.32%, 65.85% 88.65%, 64.82% 88.82%, 61.94% 89.14%, 59.07% 89.31%, 39.54% 89.31%, 36.45% 88.98%, 35.22% 88.82%, 33.57% 88.49%, 32.55% 88.16%, 32.13% 87.99%, 31.52% 87.66%, 30.90% 87.17%, 30.69% 86.68%, 30.49% 86.02%, 26.58% 72.04%, 18.77% 34.70%, 18.56% 33.72%, 18.36% 32.40%)',
    working: 'polygon(8.88% 59.70%, 15.67% 18.75%, 15.87% 18.42%, 16.28% 17.93%, 16.69% 17.60%, 17.52% 17.11%, 18.34% 16.78%, 20.81% 16.12%, 43.01% 11.02%, 44.65% 10.69%, 46.71% 10.36%, 47.94% 10.20%, 50.00% 10.03%, 54.52% 10.03%, 56.58% 10.20%, 57.81% 10.36%, 58.84% 10.53%, 59.66% 10.69%, 61.10% 11.02%, 77.96% 15.46%, 79.61% 15.95%, 80.63% 16.28%, 81.87% 16.94%, 82.89% 17.76%, 83.10% 18.09%, 85.77% 30.59%, 85.98% 31.91%, 86.18% 33.55%, 86.18% 33.72%, 85.98% 36.35%, 82.07% 78.12%, 81.66% 81.09%, 81.46% 81.74%, 81.25% 82.24%, 80.63% 83.22%, 80.02% 83.88%, 79.40% 84.38%, 78.78% 84.70%, 77.14% 85.36%, 74.67% 86.02%, 62.75% 88.65%, 60.69% 88.98%, 48.36% 89.31%, 24.10% 89.31%, 22.66% 89.14%, 20.81% 88.82%, 19.98% 88.65%, 16.28% 87.66%, 15.05% 87.17%, 13.82% 86.51%, 12.38% 85.36%, 11.97% 84.87%, 11.35% 83.88%, 11.14% 83.39%, 10.94% 82.40%, 8.88% 61.02%)',
    thinking: 'polygon(19.74% 30.59%, 21.38% 17.43%, 21.59% 17.11%, 23.03% 16.28%, 27.75% 13.98%, 28.17% 13.82%, 29.19% 13.49%, 30.22% 13.32%, 48.93% 11.84%, 53.25% 11.84%, 76.27% 13.98%, 77.71% 14.31%, 78.12% 14.64%, 78.74% 15.30%, 82.03% 21.88%, 82.24% 23.03%, 79.77% 36.02%, 79.56% 37.01%, 72.57% 70.23%, 68.67% 86.18%, 68.26% 87.01%, 68.05% 87.34%, 67.43% 87.83%, 66.61% 88.32%, 66.20% 88.49%, 65.58% 88.65%, 64.76% 88.82%, 63.73% 88.98%, 61.68% 89.14%, 59.42% 89.31%, 35.36% 89.31%, 30.43% 88.98%, 26.73% 88.49%, 25.29% 88.16%, 24.67% 87.99%, 23.85% 87.66%, 22.82% 86.84%, 22.62% 86.51%, 22.00% 85.20%, 19.74% 33.88%)',
    celebrate: 'polygon(10.38% 49.51%, 19.22% 15.30%, 20.25% 14.31%, 22.92% 12.34%, 24.98% 11.84%, 25.80% 11.68%, 46.36% 9.70%, 48.21% 9.54%, 53.15% 9.54%, 54.58% 9.70%, 74.94% 12.34%, 77.41% 12.66%, 78.43% 12.83%, 79.87% 13.49%, 80.08% 13.65%, 81.11% 14.64%, 81.72% 15.79%, 90.77% 49.18%, 90.77% 50.33%, 89.74% 53.78%, 69.59% 86.84%, 69.18% 87.50%, 68.77% 87.83%, 67.54% 88.32%, 66.92% 88.49%, 65.28% 88.82%, 63.84% 88.98%, 62.19% 89.14%, 60.14% 89.31%, 40.40% 89.31%, 37.52% 89.14%, 34.85% 88.82%, 33.82% 88.65%, 31.97% 88.16%, 30.74% 87.66%, 30.32% 87.34%, 29.91% 86.68%, 11.41% 53.62%, 10.38% 50.33%)',
    failed: 'polygon(6.89% 38.32%, 16.14% 15.46%, 16.55% 15.13%, 17.58% 14.47%, 19.22% 13.82%, 20.66% 13.49%, 41.84% 8.88%, 43.48% 8.55%, 45.54% 8.22%, 47.18% 8.06%, 53.97% 8.06%, 56.02% 8.22%, 79.26% 10.69%, 80.69% 11.02%, 84.40% 13.65%, 84.81% 13.98%, 85.42% 14.64%, 85.63% 15.13%, 86.04% 16.45%, 86.04% 17.43%, 84.81% 31.58%, 84.19% 37.83%, 78.84% 76.48%, 78.23% 77.80%, 76.17% 82.07%, 74.94% 84.54%, 73.91% 86.35%, 73.50% 86.84%, 72.68% 87.50%, 72.06% 87.83%, 71.24% 88.16%, 70.21% 88.49%, 68.98% 88.82%, 66.30% 89.14%, 64.86% 89.31%, 55.20% 89.31%, 29.91% 88.65%, 25.19% 88.32%, 23.13% 88.16%, 21.90% 87.99%, 20.87% 87.83%, 19.22% 87.50%, 17.37% 87.01%, 15.73% 86.35%, 14.49% 85.69%, 13.47% 84.87%, 12.64% 83.55%, 7.71% 45.89%, 6.89% 39.14%)',
    wave: 'polygon(11.04% 38.82%, 21.53% 14.97%, 21.73% 14.64%, 22.35% 14.14%, 23.17% 13.82%, 24.61% 13.32%, 25.23% 13.16%, 28.31% 12.66%, 48.05% 10.36%, 51.75% 10.03%, 52.16% 10.03%, 55.04% 10.20%, 56.68% 10.36%, 77.04% 12.99%, 79.09% 13.32%, 80.32% 13.82%, 80.53% 13.98%, 81.15% 14.64%, 81.56% 35.20%, 81.56% 35.69%, 81.35% 36.68%, 70.87% 86.35%, 70.66% 86.84%, 70.25% 87.34%, 69.43% 87.99%, 69.02% 88.16%, 67.99% 88.49%, 67.17% 88.65%, 66.14% 88.82%, 64.70% 88.98%, 63.06% 89.14%, 61.00% 89.31%, 40.03% 89.31%, 37.56% 89.14%, 35.92% 88.98%, 33.66% 88.65%, 31.81% 88.32%, 30.78% 87.99%, 29.95% 87.66%, 29.13% 87.01%, 13.51% 50.16%, 11.04% 42.76%)',
    jump: 'polygon(10.96% 40.13%, 11.78% 36.84%, 12.60% 34.05%, 12.81% 33.55%, 18.98% 19.08%, 19.18% 18.75%, 23.09% 14.31%, 23.50% 13.98%, 24.53% 13.32%, 25.76% 12.99%, 26.79% 12.83%, 47.35% 10.86%, 49.20% 10.69%, 51.05% 10.69%, 53.93% 10.86%, 55.16% 11.02%, 77.16% 14.47%, 77.78% 14.64%, 79.01% 15.13%, 79.21% 15.30%, 79.83% 16.12%, 90.11% 36.84%, 90.52% 39.31%, 90.52% 40.62%, 89.70% 44.08%, 80.24% 73.19%, 80.04% 73.68%, 79.42% 74.67%, 70.99% 87.66%, 70.37% 88.16%, 69.14% 88.49%, 67.50% 88.82%, 66.47% 88.98%, 64.41% 89.14%, 61.53% 89.31%, 39.54% 89.31%, 35.83% 89.14%, 32.55% 88.82%, 30.90% 88.49%, 30.28% 88.32%, 29.67% 87.99%, 29.46% 87.83%, 29.05% 87.34%, 21.44% 75.66%, 20.42% 73.85%, 20.21% 73.36%, 11.16% 43.42%, 10.96% 40.79%)',
    runright: 'polygon(15.48% 71.88%, 23.29% 12.99%, 23.70% 12.17%, 23.91% 11.84%, 24.32% 11.51%, 26.17% 10.69%, 30.08% 9.87%, 46.94% 7.73%, 49.81% 7.40%, 52.08% 7.24%, 57.42% 7.24%, 61.12% 7.73%, 63.59% 8.22%, 65.03% 8.55%, 66.67% 9.05%, 78.60% 12.66%, 80.65% 13.32%, 81.06% 13.49%, 82.50% 14.14%, 82.71% 14.31%, 83.33% 14.97%, 84.35% 27.47%, 84.35% 31.74%, 83.94% 38.98%, 76.75% 74.51%, 76.13% 76.64%, 75.72% 77.96%, 70.99% 87.50%, 70.79% 87.66%, 67.08% 88.82%, 64.41% 89.31%, 61.94% 89.47%, 59.27% 89.47%, 54.34% 89.14%, 25.14% 86.84%, 23.09% 86.51%, 20.00% 84.87%, 19.80% 84.70%, 16.30% 77.47%, 15.89% 75.99%, 15.48% 74.01%)',
    runleft: 'polygon(14.93% 27.47%, 15.95% 15.13%, 16.16% 14.80%, 17.19% 13.98%, 18.63% 13.32%, 19.65% 12.99%, 32.61% 9.05%, 35.69% 8.22%, 38.16% 7.73%, 41.86% 7.24%, 47.20% 7.24%, 49.67% 7.40%, 52.34% 7.73%, 69.20% 9.87%, 73.11% 10.69%, 74.75% 11.35%, 75.37% 11.68%, 75.58% 12.01%, 75.99% 12.83%, 82.15% 55.92%, 84.42% 71.88%, 84.42% 74.01%, 84.00% 75.99%, 83.59% 77.47%, 80.10% 84.70%, 79.89% 84.87%, 76.81% 86.51%, 74.75% 86.84%, 45.56% 89.14%, 40.62% 89.47%, 37.95% 89.47%, 35.49% 89.31%, 32.81% 88.82%, 29.11% 87.66%, 28.91% 87.50%, 24.18% 77.96%, 23.77% 76.64%, 23.15% 74.51%, 15.54% 39.31%, 14.93% 31.58%)',
  }


  // 纯状态机：base 决定平时显示什么，transient 是播一次就回去的短动作。
  // 与 Codex 版保持同一套语义，只是多允许 thinking 作为 base。
  function createController({ show, prepare = async () => {}, isProtected = () => false,
    schedule = setTimeout, cancel = clearTimeout }) {
    let enabled = true, disposed = false, base = 'idle', current = null
    let transient = null, timer = null, generation = 0, loading = null, lastNoticeId = ''
    // 页面刷新后不要重播上一轮的庆祝/失败：把最近处理过的 notice key 持久化。
    try { lastNoticeId = String(window.localStorage.getItem('dshw-shenshen-notice') || '') } catch (err) {}
    let dragging = false
    let dragDirection = 'right'
    const failed = new Set()
    const desired = () => (dragging ? (dragDirection === 'left' ? 'runleft' : 'runright') : transient ? transient.action : base)
    const stopTimer = () => { if (timer !== null) cancel(timer); timer = null }
    function invalidate() { ++generation; loading = null }
    function arm() {
      if (!transient || timer !== null) return
      const item = transient
      timer = schedule(() => {
        if (disposed || transient !== item) return
        timer = null
        transient = null
        invalidate()
        sync()
      }, DURATIONS[item.action])
    }
    function sync() {
      // 拖拽态本身就是要覆盖当前动作，不能被宿主的 dragging 保护挡住。
      if (!enabled || disposed || (!dragging && isProtected())) return
      const action = desired()
      if (current === action) { arm(); return }
      if (failed.has(action) || (loading && loading.action === action)) return
      const token = ++generation
      loading = { action, token }
      Promise.resolve().then(() => prepare(action)).then(() => {
        if (!enabled || disposed || generation !== token || desired() !== action) return
        loading = null
        // 解码期间用户可能已经开始拖拽；拖拽态本身不受保护限制。
        if (!dragging && isProtected()) return
        show(action)
        current = action
        arm()
      }).catch(() => {
        if (generation !== token || disposed) return
        loading = null
        failed.add(action)
        if (transient && transient.action === action) { transient = null; invalidate(); sync() }
      })
    }
    function trigger(action) {
      if (!enabled || disposed || !Object.prototype.hasOwnProperty.call(DURATIONS, action)) return false
      stopTimer()
      transient = { action }
      invalidate()
      sync()
      return true
    }
    const controller = {
      // status 来自 /dsh-whale/shenshen-status.json
      setStatus(status) {
        if (disposed) return
        const turns = status && status.activeTurns
        const waiting = !!(status && status.waiting === true)
        if (!waiting && !(typeof turns === 'number' && Number.isFinite(turns) && turns >= 0)) return
        const next = waiting ? 'thinking' : turns > 0 ? 'working' : 'idle'
        if (next === base) return
        base = next
        if (!transient) invalidate()
        sync()
      },
      onNotice(notice) {
        if (!notice || disposed) return false
        const kind = notice.completionKind || notice.kind
        if (!['success', 'failed', 'cancelled'].includes(kind)) return false
        const id = notice.id == null ? '' : String(notice.id)
        if (id && id === lastNoticeId) return false
        if (id) {
          lastNoticeId = id
          try { window.localStorage.setItem('dshw-shenshen-notice', id) } catch (err) {}
        }
        // 自定义角色期间不播动画，但 notice 仍要记为已处理，避免切回默认后补播旧事件。
        if (!enabled) return false
        if (kind === 'cancelled') {
          stopTimer(); transient = null; invalidate(); sync(); return true
        }
        return trigger(kind === 'success' ? 'celebrate' : 'failed')
      },
      trigger,
      // 拖拽开始/结束：按拖动方向循环对应朝向的跑步帧，松手后再交给 wave/jump。
      setDragging(value, direction) {
        if (disposed) return
        const next = !!value
        const dir = direction === 'left' ? 'left' : 'right'
        if (dragging === next && dragDirection === dir) return
        dragging = next
        dragDirection = dir
        if (next) { stopTimer(); transient = null }
        invalidate()
        sync()
      },
      setEnabled(value) {
        if (disposed || enabled === !!value) return
        enabled = !!value
        stopTimer(); transient = null; current = null; invalidate(); sync()
      },
      flush: sync,
      // 宿主可能绕过我们直接改 img.src（切角色/回退默认）；强制按 desired 重画一次。
      refresh() {
        if (disposed) return
        current = null
        invalidate()
        sync()
      },
      status: () => ({ enabled, base, dragging, current, queued: enabled && desired() !== current ? desired() : null }),
      dispose() {
        disposed = true; enabled = false; stopTimer(); transient = null; invalidate()
      },
    }
    sync()
    return controller
  }

  // 暴露给预览/测试；真实页面里由下方自动接管。
  window.ShenshenActions = Object.freeze({ actions: ACTIONS, durations: DURATIONS, assetUrl, clips: CLIP_POLYGONS, createController })

  // 单测/预览环境里没有 document：只暴露控制器，不启动 DOM 接管。
  if (typeof document === 'undefined' || !document) return

  function boot() {
    let tries = 0
    const timer = setInterval(() => {
      const img = document.querySelector('.dshwv-img')
      const root = document.querySelector('.dshwv-root')
      if (img && root) { clearInterval(timer); setup(img, root); return }
      if (++tries > 120) clearInterval(timer) // 60s 后放弃，不影响宿主
    }, 500)
  }

  function setup(img, root) {
    const decoded = new Map()
    function prepare(action) {
      const url = urlFor(action)
      if (!decoded.has(url)) {
        const image = new Image()
        image.src = url
        // APNG 解码失败不应让整个动作永久禁用；这里吞掉错误，show 时再试一次。
        decoded.set(url, image.decode().catch(() => {}))
      }
      return decoded.get(url)
    }

    // 指针是否按下：宿主拖拽类可能因丢失 pointerup 残留；保护态必须同时看指针状态，
    // 否则一次卡住后动作会永远停在保护态。
    let pointerDown = false

    const controller = createController({
      prepare,
      isProtected: () => pointerDown && root.classList.contains('dshwv-dragging'),
      show(action) {
        const url = urlFor(action)
        const clip = CLIP_POLYGONS[action] || ''
        img.alt = '深深 · ' + (LABELS[action] || action)
        // sidecar 直接控制视觉裁切（按动作预计算、横向放宽 1.25 倍）；
        // 宿主异步的 setupHitTest 只会更新命中图，不再决定画面被裁到哪里。
        try {
          // 即使当前动作没有预计算轮廓，也把 override 置空，避免沿用上一动作的裁切。
          window.__dshwvShenshenClipOverride = clip
          if (clip) {
            img.style.clipPath = clip
            img.style.webkitClipPath = clip
          }
        } catch (err) {}
        try { if (typeof window.__dshwvShenshenClearHit === 'function') window.__dshwvShenshenClearHit() } catch (err) {}
        img.src = url
        try {
          if (typeof window.__dshwvShenshenHit === 'function') window.__dshwvShenshenHit(maskUrlFor(action))
          else if (!clip) { img.style.clipPath = ''; img.style.webkitClipPath = '' }
        } catch (err) {}
        try { img.dataset.shenshenAction = action } catch (err) {}
      },
    })

    try { window.__shenshenStatus = () => controller.status() } catch (err) {}

    // —— 角色切换：只有默认角色（/dsh-whale/image.png）才接管 ——
    // 注意 img.src 会被浏览器解析成绝对 URL，比较必须走 pathname。
    function pathOf(value) {
      try { return new URL(String(value || ''), location.href).pathname } catch (err) { return String(value || '') }
    }
    const observer = new MutationObserver(() => {
      const src = pathOf(img.getAttribute('src'))
      if (src === '/dsh-whale/shenshen-image.png') return
      if (src === '/dsh-whale/role-image.png') {
        controller.setEnabled(false)
        // 自定义角色：撤掉深深轮廓，并让宿主按当前角色图重新算一份裁切/命中图。
        try { window.__dshwvShenshenClipOverride = '' } catch (err) {}
        try {
          if (typeof window.__dshwvShenshenHit === 'function') window.__dshwvShenshenHit(img.currentSrc || img.src)
        } catch (err) {}
      } else if (src === '/dsh-whale/image.png') {
        controller.setEnabled(true)
        controller.refresh()
      }
    })
    try { observer.observe(img, { attributes: true, attributeFilter: ['src'] }) } catch (err) {}

    // —— 点击挥手 / 拖动小跳 ——
    // 监听在 document 捕获阶段：宿主的 onDocPointerDown/Up 会 stopPropagation，
    // 但同节点同阶段的监听仍会执行，因此不会漏事件。
    const hitPet = (event) => {
      try {
        if (typeof event.composedPath === 'function' && event.composedPath().includes(img)) return true
      } catch (err) {}
      return event.target === img || !!(event.target && event.target.closest && event.target.closest('.dshwv-img') === img)
    }
    let gesture = null
    let pendingRelease = null
    let pendingTimer = null
    function flushPendingRelease() {
      if (pendingTimer !== null) { clearTimeout(pendingTimer); pendingTimer = null }
      if (!pendingRelease) return
      const release = pendingRelease
      pendingRelease = null
      controller.trigger(release.moved ? 'jump' : 'wave')
    }
    function releaseGesture(moved) {
      pointerDown = false
      controller.setDragging(false)
      pendingRelease = { moved }
      // 宿主的 endDrag 在本次 pointerup 里同步执行；类摘掉后由 observer 立即收尾。
      // 万一类没被摘掉（丢事件/宿主异常），400ms 后也强制收尾，绝不无限等待。
      if (!root.classList.contains('dshwv-dragging')) flushPendingRelease()
      else {
        if (pendingTimer !== null) clearTimeout(pendingTimer)
        pendingTimer = setTimeout(flushPendingRelease, 400)
      }
    }
    // 宿主的 onDocPointerUp 是在拖拽开始时才注册的，比这里晚；所以我们的 pointerup 先跑。
    // 等 .dshwv-dragging 摘掉再播短动作，既不和回弹动画打架，也不会被保护态吞掉。
    const rootObserver = new MutationObserver(() => {
      if (root.classList.contains('dshwv-dragging')) return
      flushPendingRelease()
      // 保护期间被推迟的动作切换（短动作计时结束、状态变化）在这里补一次，
      // 避免“点击后卡在某个动作”。
      controller.flush()
    })
    try { rootObserver.observe(root, { attributes: true, attributeFilter: ['class'] }) } catch (err) {}

    // 视觉朝向 = 拖动方向；停靠左侧时 root 有 scaleX(-1)，要反向选图才能跟手。
    function applyDragDirection(visualDir) {
      const flipped = root.classList.contains('dshwv-left')
      const wantLeft = visualDir === 'left'
      const assetDir = (wantLeft !== flipped) ? 'left' : 'right'
      controller.setDragging(true, assetDir)
    }

    document.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.pointerType === 'touch') return
      if (!hitPet(event)) return
      pointerDown = true
      pendingRelease = null
      gesture = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        lastX: event.clientX, moved: false, dir: null, opposite: 0,
      }
    }, true)
    document.addEventListener('pointermove', (event) => {
      if (!gesture || event.pointerId !== gesture.id) return
      // pointerup 丢失：buttons 已归零 → 按当前位置收尾，避免 drag 态卡死。
      if (event.buttons === 0) {
        const moved = gesture.moved
        gesture = null
        releaseGesture(moved)
        return
      }
      const totalDx = event.clientX - gesture.x
      const totalDy = event.clientY - gesture.y
      const stepX = event.clientX - gesture.lastX
      gesture.lastX = event.clientX
      if (!gesture.moved) {
        if (totalDx * totalDx + totalDy * totalDy < 9) return
        gesture.moved = true
        const initial = stepX !== 0 ? stepX : totalDx
        gesture.dir = initial < 0 ? 'left' : 'right'
        gesture.opposite = 0
        applyDragDirection(gesture.dir)
        return
      }
      // 关键：方向按“最近一次移动”判断，而不是相对按下点。
      // 否则左拖一段再右拖，要越过起点才会换向，看起来就是“方向没变”。
      if (stepX === 0) return
      const dir = stepX < 0 ? 'left' : 'right'
      if (dir === gesture.dir) {
        gesture.opposite = 0
        // 同方向也重算一次：宿主可能在拖动中切换 .dshwv-left 镜像，选图要跟着换。
        applyDragDirection(dir)
        return
      }
      gesture.opposite += Math.abs(stepX)
      // 5px 反向位移才换向，过滤 1px 抖动，又不会等太久。
      if (gesture.opposite < 5) return
      gesture.dir = dir
      gesture.opposite = 0
      applyDragDirection(dir)
    }, true)
    document.addEventListener('pointerup', (event) => {
      if (!gesture || event.pointerId !== gesture.id) return
      const moved = gesture.moved
      gesture = null
      releaseGesture(moved)
    }, true)
    // 只在“真的有按下中的手势”时取消；pointerup 之后浏览器还会摘掉 pointer capture，
    // 那时 pendingRelease 必须保留给 observer/超时收尾，不能被取消掉。
    const cancelGesture = () => {
      pointerDown = false
      if (!gesture) return
      gesture = null
      pendingRelease = null
      if (pendingTimer !== null) { clearTimeout(pendingTimer); pendingTimer = null }
      controller.setDragging(false)
    }
    document.addEventListener('pointercancel', cancelGesture, true)
    document.addEventListener('lostpointercapture', cancelGesture, true)
    window.addEventListener('blur', cancelGesture)
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelGesture() })

    // —— 状态轮询 ——
    let polling = false
    async function poll() {
      if (polling || document.hidden || !controller.status().enabled) return
      polling = true
      try {
        const response = await fetch(STATUS_PATH, { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        if (!data || data.ok === false) return
        controller.setStatus({ activeTurns: data.activeTurns, waiting: data.waiting })
        if (data.notice && data.notice.kind) {
          // 用 id + at 组合去重：宿主重启后 id 会从头计数，at 能区分新一轮。
          controller.onNotice({
            id: 'dsh-' + data.notice.id + '-' + (data.notice.at || ''),
            completionKind: data.notice.kind,
          })
        }
      } catch (err) {
        // 宿主重启/插件停用时静默；下一轮再试。
      } finally {
        polling = false
        // 自愈：拖拽类可能因丢事件残留；指针已抬起时强制退出 drag 态。
        if (controller.status().dragging && !pointerDown) controller.setDragging(false)
        // 保护期/竞态里被推迟的切换，下一轮补一次，确保不会卡在某个动作。
        controller.flush()
      }
    }
    const pollTimer = setInterval(poll, 2500)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll() })
    poll()

    // 预解码全部动作，切换时不等图；掩膜也顺手预热，避免首次换动作时命中轮廓慢半拍。
    for (const action of ACTIONS) {
      prepare(action).catch(() => {})
      try { new Image().src = maskUrlFor(action) } catch (err) {}
    }
    for (const action of ['runright', 'runleft']) {
      prepare(action).catch(() => {})
      try { new Image().src = maskUrlFor(action) } catch (err) {}
    }

    window.addEventListener('beforeunload', () => {
      controller.dispose()
      clearInterval(pollTimer)
      if (pendingTimer !== null) { clearTimeout(pendingTimer); pendingTimer = null }
      try { window.__dshwvShenshenClipOverride = '' } catch (err) {}
      try { observer.disconnect() } catch (err) {}
      try { rootObserver.disconnect() } catch (err) {}
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
