const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EXT = path.resolve(__dirname, '..');
const PROFILE = path.join(__dirname, 'profile');
const SHOTS = path.join(__dirname, 'shots');
const COURSE = 'https://cme7.91huayi.com/web/course_ware_cc.html?vid=0349ECC141B0F93CB463AB73BD4C026B';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  return box;
}

const readVideo = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    return {
      connected: v.isConnected,
      visibleRate: v.playbackRate,
      paused: v.paused,
      currentTime: v.currentTime,
      duration: v.duration,
      readyState: v.readyState,
      pip: document.pictureInPictureElement === v,
      hideFlag: v.dataset.hyvhHide === '1',
      src: (v.currentSrc || v.src || '').slice(0, 40),
    };
  });

// 通过 about:blank iframe 的未打补丁原型读取真实倍速（主世界 getter 已被兼容模式接管）
const realRate = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'display:none';
    document.documentElement.appendChild(frame);
    try {
      const desc = Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLMediaElement.prototype, 'playbackRate');
      return desc.get.call(v);
    } finally {
      frame.remove();
    }
  });

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    pipe: true,
    headless: false,
    defaultViewport: null,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const errors = [];
  try {
    const cdp = await browser.target().createCDPSession();
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: EXT });
    console.log('extension:', extId);
    console.log('installed:', JSON.stringify(await cdp.send('Extensions.getExtensions')));
    console.log('');

    const page = await browser.newPage();
    page.on('pageerror', (e) => {
      errors.push(`pageerror: ${e.message}`);
      console.log('[pageerror]', e.message);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') {
        errors.push(`console: ${m.text()}`);
        console.log('[console.error]', m.text());
      }
    });

    await page.goto(COURSE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return !!v && v.readyState >= 2 && !v.paused;
      },
      { timeout: 45000 }
    );
    await page.waitForFunction(() => !!document.getElementById('hyvh-host'), { timeout: 15000 });
    await sleep(1500);

    // 1. 面板注入
    const panel = await page.evaluate(() => {
      const host = document.getElementById('hyvh-host');
      const root = host && host.shadowRoot;
      return {
        host: !!host,
        title: root ? root.querySelector('.title')?.textContent : null,
        presets: root ? root.querySelectorAll('.preset').length : 0,
        visible: host ? getComputedStyle(host).display !== 'none' : false,
      };
    });
    check('内容脚本注入并显示控制面板', panel.host && panel.visible, JSON.stringify(panel));

    // 2. 视频可播放
    const v0 = await readVideo(page);
    check('检测到 <video> 且正在播放', !!v0 && !v0.paused && v0.readyState >= 2, JSON.stringify(v0));

    await page.screenshot({ path: path.join(SHOTS, '1-panel.png') });

    // 3. 点击 1.5x
    await clickInShadow(page, 'hyvh-host', '.preset[data-rate="1.5"]');
    await sleep(1200);
    const v1 = await readVideo(page);
    const r1 = await realRate(page);
    check('点击 1.5x 后真实倍速生效', r1 === 1.5, `real=${r1}`);
    check('兼容模式下页面读取到的倍速仍为 1x', v1.visibleRate === 1, `visible=${v1.visibleRate}`);
    check('兼容模式已给视频打上隐藏标记', v1.hideFlag === true);

    // 3.1 拦截痕迹对页面不可见
    const disguise = await page.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      const viaReflect = Reflect.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      return {
        src: String(desc.get),
        reflectSrc: String(viaReflect.get),
        native: /\[native code\]/.test(String(desc.get)),
        sameDescriptor: desc.get === viaReflect.get,
      };
    });
    check('getOwnPropertyDescriptor 看不到拦截痕迹', disguise.native && disguise.sameDescriptor, JSON.stringify(disguise));

    // 3.2 播放器把倍速重置为 1 后自动恢复
    await page.evaluate(() => {
      document.querySelector('video').playbackRate = 1;
    });
    await sleep(2500);
    const restored = await realRate(page);
    check('播放器重置倍速后自动恢复 1.5x', restored === 1.5, `real=${restored}`);

    // 4. 播放器未被检测销毁，且实际播放速度变快
    const t0 = Date.now();
    const before = (await readVideo(page)).currentTime;
    await sleep(6000);
    const v2 = await readVideo(page);
    const elapsed = (Date.now() - t0) / 1000;
    const ratio = (v2.currentTime - before) / elapsed;
    check('播放器未被倍速检测中断（视频仍在播放）', !!v2 && v2.connected && !v2.paused, `paused=${v2.paused}`);
    check('实际播放速度约为 1.5x', ratio > 1.3 && ratio < 1.7, `实测 ${ratio.toFixed(2)}x`);

    // 5. 面板状态同步
    const ui = await page.evaluate(() => {
      const root = document.getElementById('hyvh-host').shadowRoot;
      return {
        chip: root.querySelector('[data-chip]').textContent,
        active: root.querySelector('.preset.active')?.dataset.rate,
      };
    });
    check('面板显示当前倍速', ui.chip === '1.5x' && ui.active === '1.5', JSON.stringify(ui));

    // 5.1 锁定倍速开关
    await clickInShadow(page, 'hyvh-host', '[data-act="lock"]');
    await sleep(500);
    const lockOff = await page.evaluate(() => {
      const root = document.getElementById('hyvh-host').shadowRoot;
      return {
        on: root.querySelector('[data-act="lock"]').classList.contains('on'),
        label: root.querySelector('[data-locklabel]').textContent,
      };
    });
    check('可切换「锁定倍速」开关', !lockOff.on && lockOff.label === '自由倍速', JSON.stringify(lockOff));
    await clickInShadow(page, 'hyvh-host', '[data-act="lock"]');
    await sleep(400);

    await page.screenshot({ path: path.join(SHOTS, '2-speed-1.5x.png') });

    // 6. 画中画
    await clickInShadow(page, 'hyvh-host', '[data-act="pip"]');
    await sleep(1500);
    const pip = await readVideo(page);
    check('点击画中画进入 PiP', pip.pip === true, `pip=${pip.pip}`);
    const pipLabel = await page.evaluate(
      () => document.getElementById('hyvh-host').shadowRoot.querySelector('[data-act="pip"]').textContent
    );
    check('画中画按钮状态切换为“退出小窗”', pipLabel === '退出小窗', pipLabel);
    await page.screenshot({ path: path.join(SHOTS, '3-pip.png') });

    await clickInShadow(page, 'hyvh-host', '[data-act="pip"]');
    await sleep(1000);
    check('再次点击退出画中画', (await readVideo(page)).pip === false);

    // 7. 快捷键 Alt+↑ 调速
    await page.bringToFront();
    await page.keyboard.down('Alt');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Alt');
    await sleep(800);
    const r3 = await realRate(page);
    check('快捷键 Alt+↑ 提升到 1.75x', r3 === 1.75, `real=${r3}`);

    // 8. 收起 / 展开
    await clickInShadow(page, 'hyvh-host', '[data-act="collapse"]');
    await sleep(600);
    const collapsed = await page.evaluate(() => {
      const host = document.getElementById('hyvh-host');
      const root = host.shadowRoot;
      const ball = root.querySelector('.ball');
      return {
        collapsed: root.querySelector('.wrap').classList.contains('collapsed'),
        ballVisible: getComputedStyle(ball).display !== 'none',
        ballText: ball.textContent,
        hostW: host.getBoundingClientRect().width,
      };
    });
    check('可收起为悬浮球', collapsed.collapsed && collapsed.ballVisible, JSON.stringify(collapsed));
    await page.screenshot({ path: path.join(SHOTS, '4-collapsed.png') });

    await clickInShadow(page, 'hyvh-host', '[data-act="expand"]');
    await sleep(600);
    check(
      '点击悬浮球恢复面板',
      await page.evaluate(() => !document.getElementById('hyvh-host').shadowRoot.querySelector('.wrap').classList.contains('collapsed'))
    );

    // 9. 拖动面板
    const dragBox = await page.evaluate(() => {
      const host = document.getElementById('hyvh-host');
      const head = host.shadowRoot.querySelector('.head');
      const r = head.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      return { x: r.x + 40, y: r.y + r.height / 2, left: hr.left, top: hr.top };
    });
    await page.mouse.move(dragBox.x, dragBox.y);
    await page.mouse.down();
    await page.mouse.move(dragBox.x - 300, dragBox.y - 200, { steps: 12 });
    await page.mouse.up();
    await sleep(500);
    const moved = await page.evaluate(() => {
      const r = document.getElementById('hyvh-host').getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    check('面板可拖动并保存位置', moved.left < dragBox.left - 100, `left ${dragBox.left} -> ${moved.left}`);

    // 10. 刷新后保持倍速
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('video'), { timeout: 30000 });
    await page.waitForFunction(() => !!document.getElementById('hyvh-host'), { timeout: 15000 });
    await sleep(2500);
    const r4 = await realRate(page);
    const ui4 = await page.evaluate(
      () => document.getElementById('hyvh-host').shadowRoot.querySelector('[data-chip]').textContent
    );
    check('刷新后自动恢复上次倍速 1.75x', r4 === 1.75 && ui4 === '1.75x', `real=${r4} ui=${ui4}`);
    await page.screenshot({ path: path.join(SHOTS, '5-after-reload.png') });

    // 11. 3x 高速档
    await clickInShadow(page, 'hyvh-host', '.preset[data-rate="3"]');
    await sleep(1200);
    const r5 = await realRate(page);
    const t3 = Date.now();
    const c3 = (await readVideo(page)).currentTime;
    await sleep(4000);
    const v5 = await readVideo(page);
    const ratio3 = (v5.currentTime - c3) / ((Date.now() - t3) / 1000);
    check('3x 倍速生效且播放器存活', r5 === 3 && v5.connected && !v5.paused && ratio3 > 2.6, `real=${r5} 实测=${ratio3.toFixed(2)}x`);

    // 12. 课件页嵌入 iframe 时也能接管（all_frames）
    const host2 = await browser.newPage();
    await host2.goto('https://www.91huayi.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await host2.evaluate((src) => {
      const f = document.createElement('iframe');
      f.id = 'f';
      f.src = src;
      f.allow = 'autoplay; picture-in-picture';
      f.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:640px;border:0;z-index:99999;background:#000';
      document.body.appendChild(f);
    }, COURSE);
    const frame = await (await host2.$('#f')).contentFrame();
    await frame.waitForFunction(() => !!document.querySelector('video'), { timeout: 45000 });
    await frame.waitForFunction(() => !!document.getElementById('hyvh-host'), { timeout: 15000 });
    await sleep(1500);
    const inFrame = await frame.evaluate(() => ({
      host: !!document.getElementById('hyvh-host'),
      video: !!document.querySelector('video'),
      rate: document.querySelector('video').playbackRate,
    }));
    check('iframe 内自动注入并接管视频', inFrame.host && inFrame.video, JSON.stringify(inFrame));
    await host2.screenshot({ path: path.join(SHOTS, '8-iframe.png') });

    // 11. popup 通过 triggerAction 打开
    await cdp.send('Target.setDiscoverTargets', { discover: true, filter: [{ type: 'tab' }, { type: 'page' }] });
    await sleep(600);
    const targets = await cdp.send('Target.getTargets');
    const tabTarget = targets.targetInfos.find(
      (t) => t.type === 'tab' && t.url.includes('course_ware_cc.html')
    );
    if (tabTarget) {
      try {
        await cdp.send('Extensions.triggerAction', { id: extId, targetId: tabTarget.targetId });
        const popupTarget = await browser.waitForTarget((t) => t.url().includes('/popup/popup.html'), {
          timeout: 8000,
        });
        await sleep(1200);
        let txt;
        try {
          const popup = await popupTarget.asPage();
          txt = await popup.evaluate(() => ({
            status: document.querySelector('#status')?.textContent,
            chip: document.querySelector('#chip')?.textContent,
            presets: document.querySelectorAll('.preset').length,
          }));
          await popup.screenshot({ path: path.join(SHOTS, '6-popup.png') });
        } catch {
          const s = await popupTarget.createCDPSession();
          const res = await s.send('Runtime.evaluate', {
            expression:
              "JSON.stringify({status:document.querySelector('#status')?.textContent,chip:document.querySelector('#chip')?.textContent,presets:document.querySelectorAll('.preset').length})",
            returnByValue: true,
          });
          txt = JSON.parse(res.result.value);
          const shot = await s.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(SHOTS, '6-popup.png'), Buffer.from(shot.data, 'base64'));
        }
        check('popup 打开并读取到视频状态', /已接管视频/.test(txt.status || ''), JSON.stringify(txt));
      } catch (e) {
        check('popup 打开并读取到视频状态', false, e.message);
      }
    } else {
      check('popup 打开并读取到视频状态', false, '未找到 tab target');
    }

    // 12. 非视频页面不注入面板
    const home = await browser.newPage();
    home.on('pageerror', (e) => errors.push(`home pageerror: ${e.message}`));
    await home.goto('https://www.91huayi.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2000);
    const homeState = await home.evaluate(() => ({
      host: !!document.getElementById('hyvh-host'),
      videos: document.querySelectorAll('video').length,
    }));
    check('普通页面不显示面板', !homeState.host || homeState.videos === 0, JSON.stringify(homeState));
    await home.screenshot({ path: path.join(SHOTS, '7-homepage.png') });
  } finally {
    await browser.close();
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
