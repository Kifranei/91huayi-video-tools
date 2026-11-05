(() => {
  'use strict';

  if (window.__hyVideoHelper) return;
  window.__hyVideoHelper = true;

  const HOST_ID = 'hyvh-host';
  const MIN_RATE = 0.25;
  const MAX_RATE = 4;
  const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const KEY = {
    rate: 'hyvh.rate',
    lock: 'hyvh.lock',
    stealth: 'hyvh.stealth',
    pos: 'hyvh.pos',
    collapsed: 'hyvh.collapsed',
  };

  const state = {
    rate: 1,
    lock: true,
    stealth: true,
    collapsed: false,
    pos: null,
    videos: new Set(),
    host: null,
    root: null,
    els: {},
    applying: 0,
    saveTimer: 0,
    watchdog: 0,
    started: false,
  };

  const clamp = (n) => Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(Number(n) * 100) / 100));
  const fmt = (n) => `${parseFloat(clamp(n).toFixed(2))}x`;
  const area = (v) => {
    const r = v.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  };

  // 原生 playbackRate 描述符：用于读写“真实”倍速，绕过页面自己的属性劫持
  const RATE_DESC = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');

  function getRealRate(video) {
    try {
      return RATE_DESC.get.call(video);
    } catch {
      return video.playbackRate;
    }
  }

  function setRealRate(video, rate) {
    try {
      RATE_DESC.set.call(video, rate);
    } catch {
      try {
        video.playbackRate = rate;
      } catch {
        /* ignore */
      }
    }
  }

  const storage = (() => {
    try {
      return chrome.storage && chrome.storage.local;
    } catch {
      return null;
    }
  })();

  function loadState() {
    return new Promise((resolve) => {
      if (!storage) return resolve();
      try {
        storage.get([KEY.rate, KEY.lock, KEY.stealth, KEY.pos, KEY.collapsed], (res) => {
          if (chrome.runtime.lastError) return resolve();
          if (typeof res[KEY.rate] === 'number') state.rate = clamp(res[KEY.rate]);
          if (typeof res[KEY.lock] === 'boolean') state.lock = res[KEY.lock];
          if (typeof res[KEY.stealth] === 'boolean') state.stealth = res[KEY.stealth];
          if (res[KEY.pos] && Number.isFinite(res[KEY.pos].left)) state.pos = res[KEY.pos];
          if (typeof res[KEY.collapsed] === 'boolean') state.collapsed = res[KEY.collapsed];
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  function save(patch) {
    if (!storage) return;
    try {
      storage.set(patch);
    } catch {
      /* ignore */
    }
  }

  function saveRateSoon() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => save({ [KEY.rate]: state.rate }), 250);
  }

  // ---------- 视频探测 ----------

  function walkVideos(node, out) {
    if (!node || !node.querySelectorAll) return;
    node.querySelectorAll('video').forEach((v) => out.add(v));
    node.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) walkVideos(el.shadowRoot, out);
    });
  }

  function scan() {
    const found = new Set();
    walkVideos(document, found);
    let changed = false;

    for (const v of found) {
      if (!state.videos.has(v)) {
        state.videos.add(v);
        attachVideo(v);
        changed = true;
      }
    }
    for (const v of [...state.videos]) {
      if (!v.isConnected) state.videos.delete(v);
    }

    if (state.videos.size) {
      ensureUI();
      if (changed && state.lock) applyRateToAll();
    }
    updateUI();
  }

  function activeVideo() {
    const alive = [...state.videos].filter((v) => v.isConnected);
    if (!alive.length) return null;
    const loaded = alive.filter((v) => v.readyState > 0);
    const pool = loaded.length ? loaded : alive;
    return pool.find((v) => !v.paused && !v.ended) || pool.sort((a, b) => area(b) - area(a))[0];
  }

  function attachVideo(video) {
    if (video.__hyvhBound) return;
    video.__hyvhBound = true;

    setStealth(video, state.stealth);

    const reapply = () => {
      if (state.lock) setRateOn(video, state.rate);
    };

    video.addEventListener('loadedmetadata', reapply);
    video.addEventListener('play', reapply);
    video.addEventListener('seeking', reapply);
    video.addEventListener('ratechange', () => {
      if (state.applying > 0) return;
      const real = getRealRate(video);
      if (state.lock) {
        if (Math.abs(real - state.rate) > 0.01) setRateOn(video, state.rate);
        return;
      }
      if (video === activeVideo() && Math.abs(real - state.rate) > 0.01) {
        state.rate = clamp(real);
        updateUI();
        saveRateSoon();
      }
    });
    video.addEventListener('enterpictureinpicture', updateUI);
    video.addEventListener('leavepictureinpicture', updateUI);

    if (state.lock) setRateOn(video, state.rate);
  }

  // 兼容模式：给视频打上标记，main-world.js 会让页面脚本读到的倍速恒为 1，
  // 避免 CC/Polyv 等播放器检测到非 1 倍速后销毁播放器
  function setStealth(video, on) {
    if (!video) return;
    try {
      if (on) video.dataset.hyvhHide = '1';
      else delete video.dataset.hyvhHide;
    } catch {
      /* ignore */
    }
  }

  function setStealthAll(on) {
    state.stealth = !!on;
    for (const v of state.videos) {
      if (!v.isConnected) continue;
      setStealth(v, state.stealth);
      if (state.lock) setRateOn(v, state.rate);
    }
    updateUI();
  }

  function setRateOn(video, rate) {
    if (!video) return;
    state.applying++;
    try {
      setRealRate(video, rate);
      video.defaultPlaybackRate = rate;
    } catch {
      /* ignore */
    }
    state.applying--;
  }

  function applyRateToAll() {
    for (const v of state.videos) {
      if (v.isConnected) setRateOn(v, state.rate);
    }
  }

  function applyRate(rate) {
    state.rate = clamp(rate);
    applyRateToAll();
    updateUI();
    saveRateSoon();
  }

  // ---------- UI ----------

  const STYLE = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .wrap {
      width: 256px;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
      color: #e9efff;
      background: linear-gradient(180deg, rgba(24, 29, 43, .96), rgba(15, 18, 27, .96));
      border: 1px solid rgba(120, 150, 255, .22);
      border-radius: 14px;
      box-shadow: 0 14px 40px rgba(0, 0, 0, .45), 0 2px 10px rgba(0, 0, 0, .3);
      overflow: hidden;
      user-select: none;
      -webkit-user-select: none;
    }
    .wrap.collapsed { width: auto; background: transparent; border: 0; box-shadow: none; }
    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 10px 9px 12px;
      cursor: move;
      background: rgba(255, 255, 255, .03);
      border-bottom: 1px solid rgba(255, 255, 255, .06);
    }
    .logo {
      width: 20px; height: 20px; flex: 0 0 auto;
      display: grid; place-items: center;
      border-radius: 6px;
      background: linear-gradient(135deg, #4f7dff, #8a5cff);
      color: #fff; font-size: 13px; font-weight: 700; line-height: 1;
    }
    .title { font-size: 12.5px; font-weight: 600; letter-spacing: .2px; }
    .chip {
      margin-left: auto;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 11px; font-variant-numeric: tabular-nums;
      color: #9dc0ff; background: rgba(79, 125, 255, .16);
      border: 1px solid rgba(79, 125, 255, .28);
    }
    .icon {
      flex: 0 0 auto; width: 22px; height: 22px;
      display: grid; place-items: center;
      border: 0; border-radius: 6px; cursor: pointer;
      color: #aab4cc; background: transparent;
      font-size: 14px; line-height: 1;
    }
    .icon:hover { color: #fff; background: rgba(255, 255, 255, .08); }
    .body { padding: 10px 12px 12px; }
    .presets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
    .preset {
      padding: 5px 0; border-radius: 7px; cursor: pointer;
      font-size: 11.5px; font-variant-numeric: tabular-nums;
      color: #c3ccdf; background: rgba(255, 255, 255, .05);
      border: 1px solid rgba(255, 255, 255, .07);
      transition: background .12s, color .12s, border-color .12s;
    }
    .preset:hover { background: rgba(255, 255, 255, .1); color: #fff; }
    .preset.active {
      color: #fff; background: linear-gradient(135deg, #3f6dff, #7a52ff);
      border-color: transparent; box-shadow: 0 2px 10px rgba(79, 125, 255, .35);
    }
    .slider { display: flex; align-items: center; gap: 10px; margin-top: 11px; }
    .slider input[type="range"] {
      -webkit-appearance: none; appearance: none;
      flex: 1 1 auto; height: 4px; margin: 0; border-radius: 999px; outline: none;
      background: linear-gradient(90deg, #4f7dff, #8a5cff) no-repeat, rgba(255, 255, 255, .14);
      background-size: var(--fill, 50%) 100%, 100% 100%;
      cursor: pointer;
    }
    .slider input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 13px; height: 13px; border-radius: 50%;
      background: #fff; border: 0; cursor: pointer;
      box-shadow: 0 1px 6px rgba(0, 0, 0, .45);
    }
    .val {
      flex: 0 0 42px; text-align: right;
      font-size: 12px; font-variant-numeric: tabular-nums; color: #b9c6e6;
    }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 11px; }
    .btn {
      display: flex; align-items: center; justify-content: center; gap: 5px;
      padding: 7px 8px; border-radius: 8px; cursor: pointer;
      font-size: 12px; font-weight: 500;
      border: 1px solid rgba(255, 255, 255, .1);
      background: rgba(255, 255, 255, .06); color: #d6deee;
      transition: background .12s, border-color .12s, color .12s;
    }
    .btn:hover { background: rgba(255, 255, 255, .11); color: #fff; }
    .btn.primary {
      border-color: transparent; color: #fff;
      background: linear-gradient(135deg, #3f6dff, #7a52ff);
      box-shadow: 0 2px 12px rgba(79, 125, 255, .32);
    }
    .btn.primary:hover { filter: brightness(1.08); }
    .btn.on { color: #9fe6b8; border-color: rgba(80, 220, 140, .45); background: rgba(60, 200, 130, .14); }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .8; }
    .opt {
      display: flex; align-items: center; gap: 7px;
      margin-top: 10px; cursor: pointer; font-size: 11.5px; color: #b7c2d8;
    }
    .opt input { position: absolute; opacity: 0; width: 0; height: 0; }
    .track {
      position: relative; flex: 0 0 auto;
      width: 28px; height: 16px; border-radius: 999px;
      background: rgba(255, 255, 255, .14);
      border: 1px solid rgba(255, 255, 255, .1);
      transition: background .15s, border-color .15s;
    }
    .knob {
      position: absolute; top: 1px; left: 1px;
      width: 12px; height: 12px; border-radius: 50%;
      background: #cfd8ea; transition: transform .15s, background .15s;
    }
    .opt input:checked + .track { background: rgba(79, 125, 255, .85); border-color: transparent; }
    .opt input:checked + .track .knob { transform: translateX(12px); background: #fff; }
    .opt-tip { margin-left: auto; font-size: 10.5px; color: #6f7a92; }
    .tip { margin-top: 9px; font-size: 10.5px; line-height: 1.5; color: #7f8aa3; text-align: center; }
    .ball {
      width: 46px; height: 46px; padding: 0; border-radius: 50%; cursor: pointer;
      border: 1px solid rgba(120, 150, 255, .35);
      background: linear-gradient(135deg, rgba(63, 109, 255, .96), rgba(122, 82, 255, .96));
      color: #fff; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
      display: none;
    }
    .wrap.collapsed .head, .wrap.collapsed .body { display: none; }
    .wrap.collapsed .ball { display: block; }
    .toast {
      position: absolute; left: 50%; bottom: 8px; transform: translate(-50%, 8px);
      padding: 6px 10px; border-radius: 8px; white-space: nowrap;
      font-size: 11.5px; color: #fff; background: rgba(10, 12, 18, .94);
      border: 1px solid rgba(255, 255, 255, .12);
      opacity: 0; pointer-events: none; transition: opacity .16s, transform .16s;
      max-width: 232px; overflow: hidden; text-overflow: ellipsis;
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
  `;

  function markup() {
    return `
      <style>${STYLE}</style>
      <div class="wrap">
        <div class="head" data-drag>
          <span class="logo">»</span>
          <span class="title">视频助手</span>
          <span class="chip" data-chip>1x</span>
          <button class="icon" data-act="collapse" title="收起面板">⌄</button>
        </div>
        <div class="body">
          <div class="presets" data-presets></div>
          <div class="slider">
            <input type="range" min="${MIN_RATE}" max="${MAX_RATE}" step="0.05" data-slider>
            <span class="val" data-val>1x</span>
          </div>
          <div class="actions">
            <button class="btn" data-act="lock"><span class="dot" data-lockdot></span><span data-locklabel>锁定倍速</span></button>
            <button class="btn primary" data-act="pip" data-piplabel>画中画</button>
          </div>
          <label class="opt" title="对播放器隐藏真实倍速，避免 CC/Polyv 检测到倍速后中断播放">
            <input type="checkbox" data-stealth>
            <span class="track"><span class="knob"></span></span>
            <span class="opt-label">兼容模式</span>
            <span class="opt-tip">防播放器检测</span>
          </label>
          <div class="tip">Alt+↑ / Alt+↓ 调速 · Alt+0 复位 · Alt+P 画中画</div>
        </div>
        <button class="ball" data-act="expand" data-ball>1x</button>
        <div class="toast" data-toast></div>
      </div>
    `;
  }

  function ensureUI() {
    if (state.host && state.host.isConnected) return;
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position: fixed; display: block; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = markup();

    const $ = (sel) => root.querySelector(sel);
    state.host = host;
    state.root = root;
    state.els = {
      wrap: $('.wrap'),
      chip: $('[data-chip]'),
      slider: $('[data-slider]'),
      val: $('[data-val]'),
      presets: $('[data-presets]'),
      lock: $('[data-act="lock"]'),
      lockLabel: $('[data-locklabel]'),
      pip: $('[data-act="pip"]'),
      stealth: $('[data-stealth]'),
      ball: $('[data-ball]'),
      toast: $('[data-toast]'),
    };

    state.els.presets.innerHTML = PRESETS.map(
      (r) => `<button class="preset" data-rate="${r}" title="${r}x">${r}x</button>`
    ).join('');

    // 事件绑定
    root.addEventListener('click', (e) => {
      const target = e.target.closest('[data-rate], [data-act]');
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();

      if (target.dataset.rate) {
        applyRate(parseFloat(target.dataset.rate));
        return;
      }
      switch (target.dataset.act) {
        case 'collapse':
          state.collapsed = true;
          save({ [KEY.collapsed]: true });
          updateUI();
          break;
        case 'expand':
          state.collapsed = false;
          save({ [KEY.collapsed]: false });
          updateUI();
          break;
        case 'lock':
          state.lock = !state.lock;
          save({ [KEY.lock]: state.lock });
          if (state.lock) applyRateToAll();
          updateUI();
          toast(state.lock ? '已锁定倍速（播放器改动会被纠正）' : '已解除锁定，可交给播放器控制');
          break;
        case 'pip':
          togglePip();
          break;
      }
    });

    state.els.slider.addEventListener('input', () => {
      applyRate(parseFloat(state.els.slider.value));
    });
    state.els.stealth.addEventListener('change', () => {
      setStealthAll(state.els.stealth.checked);
      save({ [KEY.stealth]: state.stealth });
      toast(state.stealth ? '兼容模式已开启：对播放器隐藏真实倍速' : '兼容模式已关闭：部分播放器可能检测倍速并中断播放');
    });
    root.addEventListener('keydown', (e) => e.stopPropagation());

    bindDrag(host, root);
    applyPosition(host);
    document.documentElement.appendChild(host);
    updateUI();
  }

  function applyPosition(host) {
    if (!state.pos) {
      host.style.left = '';
      host.style.top = '';
      host.style.right = '16px';
      host.style.bottom = '16px';
      return;
    }
    const left = Math.min(Math.max(0, state.pos.left), Math.max(0, window.innerWidth - 60));
    const top = Math.min(Math.max(0, state.pos.top), Math.max(0, window.innerHeight - 60));
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  }

  function bindDrag(host, root) {
    let drag = null;
    root.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return;
        const interactive = e.target.closest('button, input, label');
        const handle = !interactive && e.target.closest('[data-drag], [data-act="expand"]');
        if (handle) {
          e.stopPropagation();
          const rect = host.getBoundingClientRect();
          drag = {
            id: e.pointerId,
            dx: e.clientX - rect.left,
            dy: e.clientY - rect.top,
            moved: false,
            x0: e.clientX,
            y0: e.clientY,
          };
          try {
            handle.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          e.preventDefault();
          return;
        }
        // 面板空白区域不把指针事件透给页面（按钮/滑块保持原生行为）
        if (!interactive) e.stopPropagation();
      },
      true
    );
    root.addEventListener(
      'pointermove',
      (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        e.stopPropagation();
        if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
        drag.moved = true;
        const w = host.offsetWidth;
        const h = host.offsetHeight;
        const left = Math.min(Math.max(0, e.clientX - drag.dx), Math.max(0, window.innerWidth - w));
        const top = Math.min(Math.max(0, e.clientY - drag.dy), Math.max(0, window.innerHeight - h));
        host.style.right = 'auto';
        host.style.bottom = 'auto';
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
        state.pos = { left, top };
      },
      true
    );
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.stopPropagation();
      if (drag.moved) save({ [KEY.pos]: state.pos });
      drag = null;
    };
    root.addEventListener('pointerup', end, true);
    root.addEventListener('pointercancel', end, true);
  }

  function toast(text) {
    const el = state.els.toast;
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el.__timer);
    el.__timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function updateUI() {
    if (!state.root) return;
    const { chip, slider, val, presets, lock, lockLabel, pip, ball, wrap, host } = {
      ...state.els,
      host: state.host,
    };
    if (!wrap) return;

    if (!state.videos.size && host) host.style.display = 'none';
    else if (host) host.style.display = 'block';

    const label = fmt(state.rate);
    if (chip) chip.textContent = label;
    if (val) val.textContent = label;
    if (ball) ball.textContent = label;
    if (slider) {
      slider.value = String(state.rate);
      const pct = ((state.rate - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100;
      slider.style.setProperty('--fill', `${pct}%`);
    }
    if (presets) {
      presets.querySelectorAll('.preset').forEach((b) => {
        b.classList.toggle('active', Math.abs(parseFloat(b.dataset.rate) - state.rate) < 0.001);
      });
    }
    if (lock) lock.classList.toggle('on', state.lock);
    if (lockLabel) lockLabel.textContent = state.lock ? '锁定倍速' : '自由倍速';
    if (pip) pip.textContent = document.pictureInPictureElement ? '退出小窗' : '画中画';
    if (state.els.stealth) state.els.stealth.checked = state.stealth;
    wrap.classList.toggle('collapsed', state.collapsed);
  }

  async function togglePip() {
    const video = activeVideo();
    if (!video) {
      toast('未找到视频');
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        toast('已退出画中画');
        return;
      }
      if (!document.pictureInPictureEnabled) {
        toast('当前页面/框架未开启画中画权限');
        return;
      }
      if (video.disablePictureInPicture) {
        try {
          Object.defineProperty(video, 'disablePictureInPicture', { value: false, configurable: true });
        } catch {
          /* ignore */
        }
      }
      if (video.readyState === 0) {
        toast('视频还没加载，先点播放再试');
        return;
      }
      await video.requestPictureInPicture();
      toast('已开启画中画，可拖动小窗');
    } catch (err) {
      const name = err && err.name;
      const text =
        name === 'NotAllowedError'
          ? '浏览器拒绝了画中画，请再点一次'
          : name === 'NotSupportedError'
            ? '该视频不支持画中画'
            : `画中画失败：${(err && err.message) || name || '未知错误'}`;
      toast(text);
    }
  }

  // ---------- 全屏适配 ----------

  function onFullscreenChange() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const parent = fsEl || document.documentElement;
    if (state.host && state.host.parentNode !== parent) parent.appendChild(state.host);
    if (state.host) applyPosition(state.host);
  }

  // ---------- 快捷键 ----------

  function onKeydown(e) {
    if (!state.videos.size) return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowUp') {
      applyRate(state.rate + 0.25);
    } else if (e.key === 'ArrowDown') {
      applyRate(state.rate - 0.25);
    } else if (e.key === '0') {
      applyRate(1);
    } else if (e.key.toLowerCase() === 'p') {
      togglePip();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!state.root) ensureUI();
  }

  // ---------- 消息（popup） ----------

  function bindMessages() {
    if (!chrome.runtime || !chrome.runtime.onMessage) return;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'hyvh:hello':
          try {
            chrome.runtime
              .sendMessage({
                type: 'hyvh:frameState',
                hasVideo: !!activeVideo(),
                videos: state.videos.size,
                rate: state.rate,
                lock: state.lock,
                stealth: state.stealth,
                pip: !!document.pictureInPictureElement,
              })
              .catch(() => {});
          } catch {
            /* ignore */
          }
          return;
        case 'hyvh:setRate':
          applyRate(msg.rate);
          sendResponse({ ok: true, rate: state.rate });
          return;
        case 'hyvh:setLock':
          state.lock = !!msg.lock;
          save({ [KEY.lock]: state.lock });
          if (state.lock) applyRateToAll();
          updateUI();
          sendResponse({ ok: true, lock: state.lock });
          return;
        case 'hyvh:setStealth':
          setStealthAll(!!msg.stealth);
          save({ [KEY.stealth]: state.stealth });
          sendResponse({ ok: true, stealth: state.stealth });
          return;
        case 'hyvh:showPanel':
          ensureUI();
          state.collapsed = false;
          save({ [KEY.collapsed]: false });
          updateUI();
          sendResponse({ ok: true });
          return;
        case 'hyvh:getState':
          sendResponse({
            hasVideo: !!activeVideo(),
            videos: state.videos.size,
            rate: state.rate,
            lock: state.lock,
            stealth: state.stealth,
            pip: !!document.pictureInPictureElement,
          });
          return;
      }
    });
  }

  // ---------- 启动 ----------

  function start() {
    if (state.started) return;
    state.started = true;

    bindMessages();

    const observer = new MutationObserver(() => {
      clearTimeout(observer.__timer);
      observer.__timer = setTimeout(scan, 150);
    });
    try {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }

    document.addEventListener(
      'play',
      (e) => {
        const v = e.target;
        if (v && v.tagName === 'VIDEO' && !state.videos.has(v)) {
          state.videos.add(v);
          attachVideo(v);
          ensureUI();
          updateUI();
        }
      },
      true
    );

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', () => state.host && applyPosition(state.host));

    // 播放器重置倍速、页面刷新/后台恢复、播放器重建时自动回到设定倍速
    clearInterval(state.watchdog);
    state.watchdog = setInterval(() => {
      if (!state.lock) return;
      const video = activeVideo();
      if (!video) return;
      if (Math.abs(getRealRate(video) - state.rate) > 0.01) setRateOn(video, state.rate);
    }, 1500);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.lock) applyRateToAll();
    });
    window.addEventListener('pageshow', () => {
      scan();
      if (state.lock) applyRateToAll();
    });
    window.addEventListener('focus', () => {
      if (state.lock) applyRateToAll();
    });

    scan();
  }

  loadState().then(() => {
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
})();
