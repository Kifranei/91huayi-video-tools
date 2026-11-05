# Changelog

本项目的重要变更都记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [1.0.0] - 2026-11-08

### Added

- 初始版本：倍速播放（0.25x–4x）、画中画、可拖动/可收起的浮动面板、快捷键、工具栏弹窗。
- 兼容模式：对 CC / Polyv 播放器隐藏真实倍速，避免播放器检测到非 1 倍速后销毁自身。
- **拦截痕迹伪装**：`main-world.js` 包裹 `Object.getOwnPropertyDescriptor` 与 `Reflect.getOwnPropertyDescriptor`，页面查询 `HTMLMediaElement.prototype.playbackRate` 时拿到原生描述符，看不到原型被改动。
- **倍速自愈**：1.5 秒看门狗 + `pageshow` / `visibilitychange` / `focus`，播放器重置倍速、切换清晰度、页面刷新、标签页切回、播放器重建后自动恢复设定倍速。
- 自动接管动态创建的视频、Shadow DOM 内的视频、iframe 内的视频。
- 倍速、面板位置、开关状态持久化。
- 纯 Node 生成图标，无第三方运行时依赖。
- 基于 CDP 的真实页面自动化测试（`test/run.js`，23 项断言）。
- 油猴脚本 `userscripts/chinahrt-speed.user.js`：为国人通（chinahrt）系继续教育平台提供倍速播放：0.25x–4x、档位/滑块、记忆、快捷键、播放器重置自愈、强制限速时自动接受实际倍速。
- `test/chinahrt-userscript.js`（`npm run test:chinahrt`）：用本地 mock 播放器验证 10 项行为，并检查真实登录页不会误注入。

### Notes

- 参考 [fuck-huayi-video](https://github.com/dennischancs/fuck-huayi-video) 中与「倍速可用性」相关的两点：`playbackRate` 劫持后的 `getOwnPropertyDescriptor` 伪装、播放器重建/页面刷新后的倍速自愈。
- 未实现的部分（与倍速、小窗无关，属于绕过学习过程本身）：拦截 `isTrusted` 合成点击检测、自动答题/签到、刷脸续期、自动跳转与伪造完成、拟人行为模拟。
- `cme7` 课件页与 bokecc 播放器本身没有 `isTrusted` / `blockAbnormalPlugin` 检测代码；面板点击是真实点击，且在 shadow root 内已 `stopPropagation`，不会触发该类检测器。
