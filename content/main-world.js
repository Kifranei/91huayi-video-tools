// 运行在页面的 MAIN world：对页面脚本隐藏被标记视频的真实倍速。
// 由隔离世界的内容脚本通过 data-hyvh-hide="1" 属性开启。
// 同时对 Object.getOwnPropertyDescriptor / Reflect 伪装，避免页面检测到原型被改动。
(() => {
  'use strict';

  if (window.__hyvhMainWorld) return;
  window.__hyvhMainWorld = true;

  const FLAG = 'hyvhHide';
  const REPORT_RATE = 1;
  const patched = new Map();

  function isHidden(el) {
    try {
      return !!el.dataset && el.dataset[FLAG] === '1';
    } catch {
      return false;
    }
  }

  function patchRate(prop) {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, prop);
    if (!desc || typeof desc.get !== 'function' || typeof desc.set !== 'function') return;
    patched.set(prop, desc);
    try {
      Object.defineProperty(HTMLMediaElement.prototype, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          if (isHidden(this)) return REPORT_RATE;
          return desc.get.call(this);
        },
        set(value) {
          desc.set.call(this, value);
        },
      });
    } catch {
      /* ignore */
    }
  }

  patchRate('playbackRate');
  patchRate('defaultPlaybackRate');

  // 页面查询这两个属性时返回原始描述符，隐藏拦截痕迹
  function nativeDescriptor(obj, prop, fallback) {
    if (obj === HTMLMediaElement.prototype && patched.has(prop)) return patched.get(prop);
    return fallback(obj, prop);
  }

  try {
    const original = Object.getOwnPropertyDescriptor;
    Object.defineProperty(Object, 'getOwnPropertyDescriptor', {
      configurable: true,
      writable: true,
      value: function getOwnPropertyDescriptor(obj, prop) {
        return nativeDescriptor(obj, prop, original);
      },
    });
  } catch {
    /* ignore */
  }

  try {
    const originalReflect = Reflect.getOwnPropertyDescriptor;
    Reflect.getOwnPropertyDescriptor = function (obj, prop) {
      return nativeDescriptor(obj, prop, originalReflect);
    };
  } catch {
    /* ignore */
  }
})();
