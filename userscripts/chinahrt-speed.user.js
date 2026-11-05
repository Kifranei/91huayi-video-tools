// ==UserScript==
// @name         chinahrt 继续教育倍速播放
// @namespace    https://github.com/Kifranei/91huayi-video-tools
// @version      1.0.0
// @description  为 chinahrt 系继续教育平台（含 hlbe.chinahrt.cn）添加倍速播放控制面板：0.25x–4x、档位/滑块、记忆、快捷键、自动恢复
// @author       Kifranei
// @match        https://*.chinahrt.cn/*
// @match        http://*.chinahrt.cn/*
// @match        https://*.chinahrt.com/*
// @match        http://*.chinahrt.com/*
// @match        https://*.chinahrt.com.cn/*
// @match        http://*.chinahrt.com.cn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.__chrSpeed) return;
  window.__chrSpeed = true;

  const HOST_ID = 'chr-speed-host';
  const KEY = { rate: 'chr.speed.rate', lock: 'chr.speed.lock', collapsed: 'chr.speed.collapsed' };
  const MIN = 0.25;
  const MAX = 4;
  const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  const state = {
    rate: 1,
    lock: true,
    collapsed: false,
    fails: 0,
    host: null,
    root: null,
    els: {},
    video: null,
    toastTimer: 0,
  };

  const clamp = (n) => Math.min(MAX, Math.max(MIN, Math.round(Number(n) * 100) / 100));
  const fmt = (n) => `${parseFloat(clamp(n).toFixed(2))}x`;
  const area = (v) => {
    const r = v.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  };

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    },
  };

  // ---------- 播放器定位 ----------

  function getPlayer() {
    const p = window.player;
    return p && typeof p === 'object' ? p : null;
  }

  function getVideo() {
    const p = getPlayer();
    if (p) {
      for (const key of ['V', 'video', 'videoElement']) {
        const v = p[key];
        if (v && v.tagName === 'VIDEO' && v.isConnected) return v;
      }
      if (typeof p.getVideoElement === 'function') {
        try {
          const v = p.getVideoElement();
          if (v && v.tagName === 'VIDEO' && v.isConnected) return v;
        } catch {
          /* ignore */
        }
      }
    }
    const list = [...document.querySelectorAll('video')].filter((v) => v.isConnected);
    if (!list.length) return null;
    return list.find((v) => !v.paused && !v.ended) || list.sort((a, b) => area(b) - area(a))[0];
  }

  function setRateOn(video, rate) {
    const p = getPlayer();
    if (p && typeof p.changePlaybackRate === 'function') {
      try {
        p.changePlaybackRate(rate);
      } catch {
        /* ignore */
      }
    }
    if (video) {
      try {
        video.playbackRate = rate;
      } catch {
        /* ignore */
      }
    }
  }

  function applyRate(rate, silent) {
    state.rate = clamp(rate);
    state.fails = 0;
    const video = getVideo();
    setRateOn(video, state.rate);
    store.set(KEY.rate, state.rate);
    render();
    if (!silent && !video) toast('还没找到视频，开始播放后会自动应用');
  }

  // ---------- UI ----------

  const STYLE = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .wrap {
      width: 236px;
      font: 12.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
      color: #e9efff;
      background: linear-gradient(180deg, rgba(24, 29, 43, .96), rgba(15, 18, 27, .96));
      border: 1px solid rgba(120, 150, 255, .22);
      border-radius: 13px;
      box-shadow: 0 14px 40px rgba(0, 0, 0, .45), 0 2px 10px rgba(0, 0, 0, .3);
      overflow: hidden;
      user-select: none;
      -webkit-user-select: none;
    }
    .wrap.collapsed { width: auto; background: transparent; border: 0; box-shadow: none; }
    .head {
      display: flex; align-items: center; gap: 7px;
      padding: 8px 9px 8px 11px;
      cursor: move;
      background: rgba(255, 255, 255, .03);
      border-bottom: 1px solid rgba(255, 255, 255, .06);
    }
    .logo {
      width: 19px; height: 19px; flex: 0 0 auto;
      display: grid; place-items: center;
      border-radius: 6px;
      background: linear-gradient(135deg, #4f7dff, #8a5cff);
      color: #fff; font-size: 12px; font-weight: 700; line-height: 1;
    }
    .title { font-size: 12px; font-weight: 600; letter-spacing: .2px; }
    .chip {
      margin-left: auto;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 10.5px; font-variant-numeric: tabular-nums;
      color: #9dc0ff; background: rgba(79, 125, 255, .16);
      border: 1px solid rgba(79, 125, 255, .28);
    }
    .icon {
      flex: 0 0 auto; width: 21px; height: 21px;
      display: grid; place-items: center;
      border: 0; border-radius: 6px; cursor: pointer;
      color: #aab4cc; background: transparent;
      font-size: 13px; line-height: 1;
    }
    .icon:hover { color: #fff; background: rgba(255, 255, 255, .08); }
    .body { padding: 9px 11px 11px; }
    .presets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
    .preset {
      padding: 5px 0; border-radius: 6px; cursor: pointer;
      font-size: 11px; font-variant-numeric: tabular-nums;
      color: #c3ccdf; background: rgba(255, 255, 255, .05);
      border: 1px solid rgba(255, 255, 255, .07);
      transition: background .12s, color .12s;
    }
    .preset:hover { background: rgba(255, 255, 255, .1); color: #fff; }
    .preset.active {
      color: #fff; background: linear-gradient(135deg, #3f6dff, #7a52ff);
      border-color: transparent; box-shadow: 0 2px 10px rgba(79, 125, 255, .35);
    }
    .slider { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
    .slider input[type="range"] {
      -webkit-appearance: none; appearance: none;
      flex: 1 1 auto; height: 4px; margin: 0; border-radius: 999px; outline: none;
      background: linear-gradient(90deg, #4f7dff, #8a5cff) no-repeat, rgba(255, 255, 255, .14);
      background-size: var(--fill, 25%) 100%, 100% 100%;
      cursor: pointer;
    }
    .slider input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 12px; height: 12px; border-radius: 50%;
      background: #fff; border: 0; cursor: pointer;
      box-shadow: 0 1px 6px rgba(0, 0, 0, .45);
    }
    .val {
      flex: 0 0 40px; text-align: right;
      font-size: 11.5px; font-variant-numeric: tabular-nums; color: #b9c6e6;
    }
    .foot { display: flex; align-items: center; gap: 7px; margin-top: 9px; font-size: 11px; color: #b7c2d8; }
    .foot label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .foot input { position: absolute; opacity: 0; width: 0; height: 0; }
    .track {
      position: relative; flex: 0 0 auto;
      width: 26px; height: 15px; border-radius: 999px;
      background: rgba(255, 255, 255, .14);
      border: 1px solid rgba(255, 255, 255, .1);
      transition: background .15s;
    }
    .knob {
      position: absolute; top: 1px; left: 1px;
      width: 11px; height: 11px; border-radius: 50%;
      background: #cfd8ea; transition: transform .15s, background .15s;
    }
    .foot input:checked + .track { background: rgba(79, 125, 255, .85); border-color: transparent; }
    .foot input:checked + .track .knob { transform: translateX(11px); background: #fff; }
    .tip { margin-top: 8px; font-size: 10px; color: #7f8aa3; text-align: center; }
    .ball {
      width: 44px; height: 44px; padding: 0; border-radius: 50%; cursor: pointer;
      border: 1px solid rgba(120, 150, 255, .35);
      background: linear-gradient(135deg, rgba(63, 109, 255, .96), rgba(122, 82, 255, .96));
      color: #fff; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
      display: none;
    }
    .wrap.collapsed .head, .wrap.collapsed .body { display: none; }
    .wrap.collapsed .ball { display: block; }
    .toast {
      position: absolute; left: 50%; bottom: 8px; transform: translate(-50%, 8px);
      padding: 5px 9px; border-radius: 8px; white-space: nowrap;
      font-size: 11px; color: #fff; background: rgba(10, 12, 18, .94);
      border: 1px solid rgba(255, 255, 255, .12);
      opacity: 0; pointer-events: none; transition: opacity .16s, transform .16s;
      max-width: 214px; overflow: hidden; text-overflow: ellipsis;
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
  `;

  function markup() {
    return `
      <style>${STYLE}</style>
      <div class="wrap">
        <div class="head" data-drag>
          <span class="logo">»</span>
          <span class="title">倍速播放</span>
          <span class="chip" data-chip>1x</span>
          <button class="icon" data-act="collapse" title="收起">⌄</button>
        </div>
        <div class="body">
          <div class="presets" data-presets></div>
          <div class="slider">
            <input type="range" min="${MIN}" max="${MAX}" step="0.05" data-slider>
            <span class="val" data-val>1x</span>
          </div>
          <div class="foot">
            <label title="播放器把倍速改回去时自动恢复">
              <input type="checkbox" data-lock>
              <span class="track"><span class="knob"></span></span>
              <span data-locklabel>锁定倍速</span>
            </label>
          </div>
          <div class="tip">Alt+↑ / Alt+↓ 调速 · Alt+0 复位 1x</div>
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
    host.style.cssText = 'position: fixed; display: block; z-index: 2147483647; right: 14px; bottom: 14px;';
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
      lock: $('[data-lock]'),
      lockLabel: $('[data-locklabel]'),
      ball: $('[data-ball]'),
      toast: $('[data-toast]'),
    };

    state.els.presets.innerHTML = PRESETS.map(
      (r) => `<button class="preset" data-rate="${r}" title="${r}x">${r}x</button>`
    ).join('');

    root.addEventListener('click', (e) => {
      const target = e.target.closest('[data-rate], [data-act]');
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      if (target.dataset.rate) {
        applyRate(parseFloat(target.dataset.rate));
        return;
      }
      if (target.dataset.act === 'collapse') {
        state.collapsed = true;
        store.set(KEY.collapsed, true);
      } else if (target.dataset.act === 'expand') {
        state.collapsed = false;
        store.set(KEY.collapsed, false);
      }
      render();
    });

    state.els.slider.addEventListener('input', () => applyRate(parseFloat(state.els.slider.value)));

    state.els.lock.addEventListener('change', () => {
      state.lock = state.els.lock.checked;
      state.fails = 0;
      store.set(KEY.lock, state.lock);
      if (state.lock) applyRate(state.rate, true);
      render();
    });

    bindDrag(host, root);
    document.documentElement.appendChild(host);
    render();
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
          drag = { id: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
          try {
            handle.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          e.preventDefault();
          return;
        }
        if (!interactive) e.stopPropagation();
      },
      true
    );
    root.addEventListener(
      'pointermove',
      (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        e.stopPropagation();
        drag.moved = true;
        const w = host.offsetWidth;
        const h = host.offsetHeight;
        const left = Math.min(Math.max(0, e.clientX - drag.dx), Math.max(0, window.innerWidth - w));
        const top = Math.min(Math.max(0, e.clientY - drag.dy), Math.max(0, window.innerHeight - h));
        host.style.right = 'auto';
        host.style.bottom = 'auto';
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
      },
      true
    );
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.stopPropagation();
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
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function render() {
    if (!state.root) return;
    const { chip, slider, val, presets, lock, lockLabel, ball, wrap, host } = state.els;
    if (host) host.style.display = state.video ? 'block' : 'none';
    const label = fmt(state.rate);
    if (chip) chip.textContent = label;
    if (val) val.textContent = label;
    if (ball) ball.textContent = label;
    if (slider) {
      slider.value = String(state.rate);
      slider.style.setProperty('--fill', `${((state.rate - MIN) / (MAX - MIN)) * 100}%`);
    }
    if (presets) {
      presets.querySelectorAll('.preset').forEach((b) => {
        b.classList.toggle('active', Math.abs(parseFloat(b.dataset.rate) - state.rate) < 0.001);
      });
    }
    if (lock) lock.checked = state.lock;
    if (lockLabel) lockLabel.textContent = state.lock ? '锁定倍速' : '自由倍速';
    wrap.classList.toggle('collapsed', state.collapsed);
  }

  // ---------- 事件 ----------

  function bindVideo(video) {
    if (!video || video.__chrSpeedBound) return;
    video.__chrSpeedBound = true;
    const reapply = () => {
      if (state.lock && Math.abs(video.playbackRate - state.rate) > 0.01) setRateOn(video, state.rate);
    };
    video.addEventListener('loadedmetadata', reapply);
    video.addEventListener('play', reapply);
    video.addEventListener('seeking', reapply);
    state.video = video;
    if (state.lock) setRateOn(video, state.rate);
  }

  function tick() {
    const video = getVideo();
    if (video && video !== state.video) bindVideo(video);
    state.video = video;
    if (!video) {
      render();
      return;
    }
    ensureUI();
    if (state.lock && Math.abs(video.playbackRate - state.rate) > 0.01) {
      if (state.fails >= 3) {
        // 连续多次被播放器改回，接受它的实际倍速，避免无休止地互相覆盖
        state.rate = clamp(video.playbackRate);
        state.fails = 0;
        store.set(KEY.rate, state.rate);
        render();
        toast(`播放器限制为 ${fmt(state.rate)}`);
        return;
      }
      setRateOn(video, state.rate);
      state.fails++;
    } else {
      state.fails = 0;
    }
    render();
  }

  function onKeydown(e) {
    if (!state.video) return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowUp') applyRate(state.rate + 0.25);
    else if (e.key === 'ArrowDown') applyRate(state.rate - 0.25);
    else if (e.key === '0') applyRate(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // ---------- 启动 ----------

  state.rate = clamp(store.get(KEY.rate, 1));
  state.lock = store.get(KEY.lock, true) !== false;
  state.collapsed = store.get(KEY.collapsed, false) === true;

  window.addEventListener('keydown', onKeydown, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  window.addEventListener('pageshow', tick);

  const observer = new MutationObserver(() => {
    clearTimeout(observer.__timer);
    observer.__timer = setTimeout(tick, 200);
  });
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    /* ignore */
  }

  setInterval(tick, 1500);
  setTimeout(tick, 300);
  setTimeout(tick, 1500);
})();
