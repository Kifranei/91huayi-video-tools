# 华医网视频助手 · 倍速 & 画中画

一个 Chrome Manifest V3 扩展，为 [91huayi.com](https://www.91huayi.com/)（华医网 / 华医科技）的课程视频加上**倍速播放**和**画中画（小窗 PiP）**，并提供一个可拖动的浮动控制面板。

## 功能

- **倍速播放**：0.25x – 4x，9 个常用档位 + 无级滑块
- **画中画**：一键把视频放进系统级小窗，可边看边做别的事
- **兼容模式**：CC / Polyv 播放器会检测非 1 倍速并销毁播放器，兼容模式会让播放器读到的倍速恒为 1x，从而不被中断；同时伪装 `Object.getOwnPropertyDescriptor` / `Reflect`，页面看不到原型被改动
- **倍速自愈**：播放器重置倍速、切换清晰度、页面刷新、标签页切回、播放器重建后，1.5 秒内自动回到设定倍速
- **锁定倍速**：播放器切换清晰度、拖动进度后自动恢复设定倍速
- **浮动面板**：可拖动、可收起成悬浮球，全屏播放时自动跟随，位置/倍速/开关状态会记住
- **快捷键**：`Alt+↑` / `Alt+↓` 调速、`Alt+0` 复位 1x、`Alt+P` 画中画
- **工具栏弹窗**：查看接管状态、快速调速、显示面板
- 支持视频在 iframe 中（`all_frames`），支持动态创建的视频与 Shadow DOM 内的视频

## 安装

1. 打开 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录（含 `manifest.json` 的那一层）
4. 打开任意课程播放页，右下角出现「视频助手」面板即安装成功

> Chrome 137+ 已移除 `--load-extension` 命令行参数，只能通过上面的方式加载。

## 使用

- 面板默认在页面右下角，拖动标题栏可移动，点 `⌄` 收起为圆形悬浮球
- 点档位按钮或拖动滑块调整倍速，面板顶部与悬浮球会显示当前倍速
- 点「画中画」进入小窗，再点一次退出（按钮会变成「退出小窗」）
- 「兼容模式」默认开启；关闭后播放器能读到真实倍速，部分播放器会直接中断播放
- 工具栏图标的弹窗可快速调速，并提示当前页面是否已接管视频

## 工作原理

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | MV3 清单，声明两个内容脚本 |
| `content/content.js` | 隔离世界：探测 `<video>`、渲染面板、调速、PiP、快捷键、与 popup 通信 |
| `content/main-world.js` | 页面主世界：`document_start` 时包裹 `HTMLMediaElement.prototype.playbackRate`，对带 `data-hyvh-hide="1"` 的视频返回 1 |
| `popup/` | 工具栏弹窗 |
| `tools/make-icons.js` | 纯 Node 生成 PNG 图标（无第三方依赖） |

关键点：Chrome 的隔离世界与页面各自持有 DOM 包装器，在隔离世界里给元素定义属性页面是看不到的。所以「对播放器隐藏真实倍速」必须放到 `world: "MAIN"` 的脚本里，通过原型 getter 实现；隔离世界只负责给视频打 `data-hyvh-hide` 标记（DOM 属性两个世界共享）。

华医网课件页用的是 CC（bokecc）H5 播放器，页面里写死 `rate_allow_change: false`，其 `timeupdate` 回调一旦发现 `video.playbackRate !== 1` 就会销毁播放器并报错，因此兼容模式是该站点倍速可用的前提。

版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 自动化测试

`test/run.js` 用 `puppeteer-core` 通过 CDP 启动本机 Chrome、加载本扩展，并在真实课件页上跑 23 项断言（面板注入、倍速生效、兼容模式隐藏、播放器存活、实际播放速率、PiP 进出、快捷键、收起/展开、拖动、刷新后保持、3x 档、iframe 注入、popup、普通页面不注入）。

```bash
npm install
npm test
```

测试脚本要点（Chrome 137+ 无法用 `--load-extension`）：

- 启动参数需带 `--enable-unsafe-extension-debugging`，并用 `--remote-debugging-pipe` 连接（puppeteer 的 `pipe: true`）
- 必须排除 puppeteer 默认参数里的 `--disable-extensions`，否则扩展会被整体禁用
- 通过 CDP `Extensions.loadUnpacked` 安装扩展，再用 `Extensions.getExtensions` 确认

测试产物截图在 `test/shots/`（已 gitignore）。

## 已知限制

- 画中画依赖页面的 Permissions Policy：如果视频位于**跨域** iframe 且 iframe 没有 `allow="picture-in-picture"`，浏览器会拒绝进入 PiP（面板会给出提示）。倍速不受此限制。
- 最高 4x；再高意义不大且更容易触发播放器异常。
- 部分平台按「开始/结束时间差」或服务端心跳计学时，倍速只改变本地播放速度，不改变服务端记录。
- 站点改版或播放器升级后选择器/检测逻辑可能失效，需要相应更新。

## 免责声明

本扩展仅调整本地播放体验（倍速、小窗）。继续教育/学分平台通常对学时认定有明确规则，使用倍速可能影响学时或学分认定，请自行确认符合平台与主办方要求，风险自负。
