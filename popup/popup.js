const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MIN_RATE = 0.25;
const MAX_RATE = 4;

const $ = (sel) => document.querySelector(sel);
const clamp = (n) => Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(Number(n) * 100) / 100));
const fmt = (n) => `${parseFloat(clamp(n).toFixed(2))}x`;

let tabId = null;
let hasVideo = false;
let rate = 1;
let lock = true;
let stealth = true;

function buildPresets() {
  $('#presets').innerHTML = PRESETS.map(
    (r) => `<button class="preset" data-rate="${r}">${r}x</button>`
  ).join('');
  $('#presets').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rate]');
    if (!btn) return;
    setRate(parseFloat(btn.dataset.rate));
  });
}

function render() {
  $('#chip').textContent = fmt(rate);
  $('#val').textContent = fmt(rate);
  const slider = $('#slider');
  slider.value = String(rate);
  slider.style.setProperty('--fill', `${((rate - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100}%`);
  document.querySelectorAll('.preset').forEach((b) => {
    b.classList.toggle('active', Math.abs(parseFloat(b.dataset.rate) - rate) < 0.001);
  });
  $('#lock').classList.toggle('on', lock);
  $('#lockLabel').textContent = lock ? '锁定倍速' : '自由倍速';
  $('#stealth').checked = stealth;
}

function setStatus(text, ok) {
  $('#status').textContent = text;
  $('#status').style.color = ok ? '#8d99b3' : '#d99b9b';
}

function setRate(value) {
  rate = clamp(value);
  render();
  if (!tabId || !hasVideo) return;
  chrome.tabs.sendMessage(tabId, { type: 'hyvh:setRate', rate }).catch(() => {});
}

function probeFrames() {
  return new Promise((resolve) => {
    const frames = [];
    const onMessage = (msg) => {
      if (msg && msg.type === 'hyvh:frameState') frames.push(msg);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.sendMessage(tabId, { type: 'hyvh:hello' }).catch(() => {});
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      const withVideo = frames.filter((f) => f.hasVideo).sort((a, b) => b.videos - a.videos);
      resolve(withVideo[0] || frames[0] || null);
    }, 320);
  });
}

async function init() {
  buildPresets();
  render();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;

  const state = await probeFrames();
  if (!state) {
    hasVideo = false;
    setStatus('当前页面没有注入脚本（请打开 91huayi 视频页）', false);
    $('#body').classList.add('disabled');
    return;
  }

  hasVideo = !!state.hasVideo;
  rate = clamp(state.rate ?? 1);
  lock = !!state.lock;
  stealth = state.stealth !== false;
  render();

  if (!hasVideo) {
    setStatus('未检测到视频，播放后会自动接管', false);
    $('#body').classList.add('disabled');
    return;
  }

  setStatus(state.pip ? '画中画进行中 · 已接管视频' : '已接管视频 · 面板在右下角', true);
  $('#body').classList.remove('disabled');
}

$('#slider').addEventListener('input', (e) => setRate(parseFloat(e.target.value)));

$('#lock').addEventListener('click', () => {
  lock = !lock;
  render();
  if (tabId && hasVideo) chrome.tabs.sendMessage(tabId, { type: 'hyvh:setLock', lock }).catch(() => {});
});

$('#stealth').addEventListener('change', (e) => {
  stealth = e.target.checked;
  if (tabId && hasVideo) chrome.tabs.sendMessage(tabId, { type: 'hyvh:setStealth', stealth }).catch(() => {});
});

$('#show').addEventListener('click', () => {
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'hyvh:showPanel' }).catch(() => {});
  window.close();
});

init();
