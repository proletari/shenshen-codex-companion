# 深深 · Codex 桌面伴侣

把 Codex 桌面挂件换成深深：保留橙衬衫、黑领带、长裤和猫耳帽的早期造型，提供 **7 组动作、42 帧透明动画**。Codex 工作时敲键盘，完成后庆祝；单击挥手，拖动松手小跳。

待机和工作动画采用固定主体，只更新眼睛及手指区域，帽子、身体、脚和电脑不会在循环中左右漂移。挥手、庆祝和跳跃保留动作本身的姿态变化。

![深深工作状态预览](docs/shenshen/preview.jpg)

## 下载与 Windows 安装

从 [Code → Download ZIP](https://github.com/proletari/shenshen-codex-companion/archive/refs/heads/master.zip) 下载完整源码，解压到固定目录；也可以使用 Git：

```powershell
git clone https://github.com/proletari/shenshen-codex-companion.git
cd shenshen-codex-companion
```

`packages/` 中保留了上游历史 ZIP，内容不含深深形象与动作。安装深深版请下载本项目源码并运行根目录入口。

安装需要支持插件的 Codex 桌面应用 / CLI，以及 **Node.js 24 或更新版本，包含 npm**。首次安装需联网下载 Electron。普通使用无需 Python，也无需手动执行 npm install。

```powershell
node --version
npm --version
```

1. 双击项目目录内的 **安装插件.cmd**，等待安装完成。请在解压后的目录运行，保留安装末尾显示的 **Private rollback receipt** 回执路径。
2. 打开 Codex 桌面应用。挂件默认自动跟随 Codex 显示。
3. 在角色菜单选择 **深深（默认角色）**。旧配置可能仍显示“小鲸鱼”；使用自定义角色的用户需要切回默认角色，才能启用深深状态动画。

安装器会备份既有插件和用户数据，复制项目到 `%USERPROFILE%\plugins\api-balance-whale`，注册插件及自动跟随任务。项目保留上游插件 ID `api-balance-whale`，因此安装会更新同一插件，不会与原小鲸鱼作为两个独立插件并存。修改下载目录中的源码后，需重新运行安装器才能更新正式安装。

如需只检查安装条件，可先运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-package.ps1 -CheckOnly
```

## 日常使用

| 操作或状态 | 深深的动作 |
| --- | --- |
| 本机 Codex 没有活跃任务 | 待机、眨眼 |
| 本机 Codex 有活跃任务 | 敲键盘 |
| 任务成功完成 | 庆祝，然后恢复当前状态 |
| 任务失败 | 排错恢复，然后恢复当前状态 |
| 单击后松手 | 挥手 |
| 拖动后松手 | 小跳 |
| 预览页面手动选择 thinking | 思考 |

想一直显示在桌面，双击 **进入独立桌面.cmd**。恢复跟随 Codex，在项目目录执行：

```powershell
node .\scripts\control.mjs follow
```

**停止挂件服务.cmd** 暂停挂件；`node .\scripts\control.mjs open` 恢复并沿用当前显示模式。**停用自动跟随.cmd** 取消自动跟随任务，保留配置与媒体。**回滚本次安装.cmd** 根据安装回执恢复旧版本。位置异常时可按 `Ctrl+Alt+W` 尝试恢复显示。

余额、用量、气泡、音效、缩放和素材工坊继续使用上游功能，详见 [上游完整使用说明](UPSTREAM-README.md)。该文档保留上游版本名和 Release 链接，指向的是原小鲸鱼版本；深深版请使用本仓库源码。

## 无需安装的动画预览

预览需要 Python。在项目根目录运行：

```powershell
python -m http.server 8766 --bind 127.0.0.1
```

打开 [本机动画预览](http://127.0.0.1:8766/desktop/ui/shenshen-preview.html)，可切换 7 种动作，模拟任务事件和拖拽。预览只加载项目图片与动作模块；关闭终端即可停止服务器。

## 开发与验证

成品 APNG 已包含在源码中。需要重建素材或运行测试时：

```powershell
npm ci --ignore-scripts
npm run build:shenshen
node --test tests/shenshen-actions.test.mjs tests/shenshen-stability.test.mjs tests/media-guard.test.mjs tests/click-geometry.test.mjs
```

上述相关检查共 **53 项测试**，已验证动作状态、交互保护、透明点击区域和固定主体。稳定性测试独立解码 APNG，逐像素确认眼睛及手指区域以外的主体保持一致。更多素材结构与修改方式见 [开发说明](SHENSHEN-DEVELOPMENT.md)。

当前已验证源码、自动测试和浏览器预览；深深版的 Windows 原生悬浮窗口、透明点击区域和自动跟随仍需安装后的实机验证。活跃任务数汇总本机 Codex 任务，不能只代表当前可见聊天。由于现有事件没有可靠的“等待用户输入”信号，thinking 暂时仅用于手动预览。macOS 上游入口保留，深深版尚未在 macOS 实测。

## 来源与许可

本项目基于 [Yang-huai406/Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public)，基线 commit 为 `4a7ec1240de82527f2222b4af5202fa7b2ad731b`；其原始项目为 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。保留 [1llysviel](https://github.com/1llysviel) 的上游 macOS 实现与署名。

上游插件 ID、内部版本 `0.4.1` 和构建标识 `surface-audio-fix-20261007` 保留，用于安装与运行兼容；它们并非深深版的新发行编号。

代码沿用 [MIT License](LICENSE)，保留原作者 MeteorNOX 的版权声明。深深参考图、生成源图与 prompt 记录位于 [docs/shenshen](docs/shenshen)，便于继续补充动作。
