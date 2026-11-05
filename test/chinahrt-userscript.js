const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SCRIPT = path.resolve(__dirname, '..', 'userscripts', 'chinahrt-speed.user.js');
const FIXTURES = path.join(__dirname, 'fixtures');
const PORT = 8124;
const LOGIN = 'https://hlbe.chinahrt.cn/login.asp?platID=17&area=7952';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.js': 'text/javascript' };

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(FIXTURES, url === '/' ? 'player.html' : url);
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const stat = fs.statSync(file);
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const [startRaw, endRaw] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startRaw, 10) || 0;
      const end = endRaw ? parseInt(endRaw, 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function clickInShadow(page, hostId, selector) {
  const box = await page.evaluate(
    (hostId, selector) => {
      const host = document.getElementById(hostId);
      const el = host && host.shadowRoot && host.shadowRoot.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    hostId,
    selector
  );
  if (!box) throw new Error(`未找到元素 ${selector}`);
  await page.mouse.click(box.x, box.y);
}

async function inject(page) {
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });
}

async function waitPanel(page) {
  await page.waitForFunction(() => !!document.getElementById('chr-speed-host'), { timeout: 10000 });
  await sleep(400);
}

(async () => {
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: null,
    args: ['--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900'],
  });

  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
    });

    await page.goto(`http://127.0.0.1:${PORT}/player.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 2;
    });
    await inject(page);
    await waitPanel(page);

    const panel = await page.evaluate(() => {
      const root = document.getElementById('chr-speed-host').shadowRoot;
      return {
        visible: getComputedStyle(document.getElementById('chr-speed-host')).display !== 'none',
        presets: root.querySelectorAll('.preset').length,
        chip: root.querySelector('[data-chip]').textContent,
      };
    });
    check('面板注入且可见', panel.visible && panel.presets === 9, JSON.stringify(panel));

    // 点击 1.5x
    await clickInShadow(page, 'chr-speed-host', '.preset[data-rate="1.5"]');
    await sleep(600);
    const afterClick = await page.evaluate(() => ({
      rate: document.querySelector('video').playbackRate,
      calls: window.__calls.slice(),
      stored: JSON.parse(localStorage.getItem('chr.speed.rate')),
      chip: document.getElementById('chr-speed-host').shadowRoot.querySelector('[data-chip]').textContent,
    }));
    check('点击 1.5x 生效并调用 player API', afterClick.rate === 1.5 && afterClick.calls.includes(1.5), JSON.stringify(afterClick));
    check('倍速写入 localStorage', afterClick.stored === 1.5, String(afterClick.stored));
    await page.screenshot({ path: path.join(__dirname, 'shots', 'chinahrt-panel.png') });

    // 播放器重置后自动恢复
    await page.evaluate(() => {
      document.querySelector('video').playbackRate = 1;
    });
    await sleep(2200);
    const restored = await page.evaluate(() => document.querySelector('video').playbackRate);
    check('播放器重置后自动恢复 1.5x', restored === 1.5, `rate=${restored}`);

    // 快捷键
    await page.keyboard.down('Alt');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Alt');
    await sleep(500);
    const afterKey = await page.evaluate(() => ({
      rate: document.querySelector('video').playbackRate,
      chip: document.getElementById('chr-speed-host').shadowRoot.querySelector('[data-chip]').textContent,
    }));
    check('Alt+↑ 提升到 1.75x', afterKey.rate === 1.75 && afterKey.chip === '1.75x', JSON.stringify(afterKey));

    // 收起 / 展开
    await clickInShadow(page, 'chr-speed-host', '[data-act="collapse"]');
    await sleep(400);
    const collapsed = await page.evaluate(() => {
      const root = document.getElementById('chr-speed-host').shadowRoot;
      return {
        collapsed: root.querySelector('.wrap').classList.contains('collapsed'),
        ball: getComputedStyle(root.querySelector('.ball')).display !== 'none',
      };
    });
    check('可收起为悬浮球', collapsed.collapsed && collapsed.ball, JSON.stringify(collapsed));
    await clickInShadow(page, 'chr-speed-host', '[data-act="expand"]');
    await sleep(300);

    // 刷新后恢复倍速
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 2;
    });
    await inject(page);
    await waitPanel(page);
    await sleep(800);
    const afterReload = await page.evaluate(() => ({
      rate: document.querySelector('video').playbackRate,
      chip: document.getElementById('chr-speed-host').shadowRoot.querySelector('[data-chip]').textContent,
    }));
    check('刷新后自动恢复 1.75x', afterReload.rate === 1.75 && afterReload.chip === '1.75x', JSON.stringify(afterReload));

    // 平台强制 1.5x 时自动接受限制
    const clampPage = await browser.newPage();
    await clampPage.goto(`http://127.0.0.1:${PORT}/player-clamp.html`, { waitUntil: 'domcontentloaded' });
    await clampPage.evaluate(() => localStorage.clear());
    await clampPage.reload({ waitUntil: 'domcontentloaded' });
    await clampPage.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 2;
    });
    await inject(clampPage);
    await waitPanel(clampPage);
    await clickInShadow(clampPage, 'chr-speed-host', '.preset[data-rate="3"]');
    await sleep(9000);
    const clamped = await clampPage.evaluate(() => ({
      rate: document.querySelector('video').playbackRate,
      chip: document.getElementById('chr-speed-host').shadowRoot.querySelector('[data-chip]').textContent,
      calls: window.__calls.length,
      stored: JSON.parse(localStorage.getItem('chr.speed.rate')),
    }));
    check(
      '播放器强制限速时自动接受实际倍速',
      clamped.rate === 1.5 && clamped.chip === '1.5x' && clamped.calls <= 8 && clamped.stored === 1.5,
      JSON.stringify(clamped)
    );

    // 无视频页面不注入面板
    const plain = await browser.newPage();
    await plain.goto(`http://127.0.0.1:${PORT}/plain.html`, { waitUntil: 'domcontentloaded' });
    await inject(plain);
    await sleep(2000);
    check('无视频页面不显示面板', await plain.evaluate(() => !document.getElementById('chr-speed-host')));

    // 真实登录页（无视频）
    const login = await browser.newPage();
    const loginErrors = [];
    login.on('pageerror', (e) => loginErrors.push(e.message));
    await login.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await inject(login);
    await sleep(2500);
    const loginState = await login.evaluate(() => ({
      host: !!document.getElementById('chr-speed-host'),
      videos: document.querySelectorAll('video').length,
      title: document.title,
    }));
    check('真实登录页无报错且不显示面板', !loginState.host && loginErrors.length === 0, JSON.stringify(loginState));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n--- 页面错误 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
