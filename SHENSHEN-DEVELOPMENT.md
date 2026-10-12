# 深深版 Codex 挂件

本项目以早期深深形象为准，保留橙衬衫、黑领带、长裤、橙色猫耳帽和毛绒手套，提供 7 组逐帧动作，共 42 帧。

按“只靠本身动作”的反馈，待机和敲键盘采用固定主体：帽子、头部轮廓、衣服、脚和电脑不会随循环左右漂移，只更新眼睛及手指区域。挥手、庆祝和跳跃等短动作仍保留各自的身体姿态。

## 来源与开发范围

- 基于 [Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public) 的 main，原始 commit：`4a7ec1240de82527f2222b4af5202fa7b2ad731b`。
- 项目仓库：[proletari/shenshen-codex-companion](https://github.com/proletari/shenshen-codex-companion)，主分支为 `master`。
- 用户选择 Codex 桌面应用，因此采用原 DeepSeek 挂件迁出的 Codex 独立仓库。
- 修改角色表现和动作接线，复用上游透明窗口、余额/用量和拖拽交互。
- 当前交付源码、素材及独立预览。未运行安装器，未修改 Codex 配置、任务日志或系统计划任务。

## 预览

从仓库根目录启动一个只监听本机的静态服务器：

```powershell
python -m http.server 8766 --bind 127.0.0.1
```

打开 <http://127.0.0.1:8766/desktop/ui/shenshen-preview.html>。页面可模拟空闲、工作、完成、失败、取消和按压保护；点击角色可挥手，拖动后释放可跳跃。预览只加载本地图片和动作模块。

| 动作 | 自动触发条件 | 恢复行为 |
| --- | --- | --- |
| idle：待机、眨眼 | 本机 Codex 活跃任务数为 0 | 持续循环 |
| working：敲键盘 | `/api/status.monitor.activeTurns > 0` | 直到全部任务结束 |
| thinking：思考 | 手动预览 | 恢复最新基础状态 |
| celebrate：完成庆祝 | `whale-turn-notice` 的 success | 播放一个动作时长后恢复 |
| failed：排错恢复 | 同一事件的 failed | 播放一个动作时长后恢复 |
| wave：挥手 | 点击角色后释放 | 播放后恢复 |
| jump：小跳 | 拖拽角色后释放 | 播放后恢复 |

短动作换图会等待上游按压、拖拽及回弹保护结束；解码和 alpha mask 准备完成后才切换。任务取消恢复基础状态；重复完成通知不会重复触发。选择自定义角色后停止深深动作，切回默认角色恢复任务状态。

**状态边界：** 活跃任务数汇总本机 Codex 任务，并不只代表当前可见聊天。现有事件没有可靠的“等待用户输入/授权”信号，thinking 未接自动等待判断。原上游 Windows 原生窗口运行与跟随能力仍需安装后的实机验证。

## Windows 正式使用

需要 Node.js 24 或更新版本及 npm。使用已打包的动作不需要手动 npm install。

1. 下载并完整解压本仓库，打开项目根目录，双击 **安装插件.cmd**。
2. 等待显示安装成功。首次会联网下载 Electron；末尾的 **Private rollback receipt** 是回滚记录路径，请保留。
3. 保持 Codex 桌面应用打开，安装后的挂件默认自动跟随 Codex 显示。在角色菜单选择 **深深（默认角色）**。旧配置可能仍将默认角色显示为“小鲸鱼”；之前使用自定义角色的用户需要切回默认角色，才能启用这组状态动画。

安装器会备份既有插件和用户配置/媒体/记录，停止本挂件旧服务，复制当前项目到 `%USERPROFILE%\plugins\api-balance-whale`，注册插件和自动跟随任务。它不会关闭或重启当前 Codex。要在 Codex 中调用新版插件工具，新建一个聊天即可；宠物动画显示不要求重启聊天。本次开发没有替你执行安装。

日常互动：单击角色松手会挥手，拖动松手会小跳；Codex 工作时敲键盘，任务结束后庆祝或排错恢复，空闲时眨眼。

需要一直留在桌面时，双击 **进入独立桌面.cmd** 或 **启动桌面挂件.cmd**。这两个入口都会切到 standalone；恢复随 Codex 显示，在项目目录执行：

```powershell
node .\scripts\control.mjs follow
```

临时关闭用 **停止挂件服务.cmd**，它会设置暂停标记，防止自动跟随立即重新启动。跟随模式暂停到当前 Codex 进程退出；独立模式持续暂停到手动恢复。要恢复并沿用当前显示模式，执行 `node .\scripts\control.mjs open`；要恢复跟随，用上面的 `follow` 命令。

**停用自动跟随.cmd** 用于停止并取消自动跟随任务，配置和媒体保留。**回滚本次安装.cmd** 用于按安装记录恢复旧版本。挂件位置异常时，可尝试 `Ctrl+Alt+W` 恢复窗口。

以后修改工作区源码或素材，需要重新运行本目录的 **安装插件.cmd**，正式安装目录不会自动同步。单独运行 **安装桌面组件.cmd** 仅准备 Electron，不能完成深深版安装。

## 文件入口

- `desktop/ui/shenshen-actions.js`：状态控制器及桌面事件 adapter。
- `desktop/ui/shenshen-preview.html/js`：隔离的中文动作预览。
- `assets/shenshen-*.png`：7 个独立透明 APNG，每组 6 帧。
- `assets/shenshen-manifest.json`：尺寸、每帧时长、源文件和锚点位移。
- `docs/shenshen/reference.png`：早期形象原始参考。
- `docs/shenshen/sources/*.png`：imagegen 原始输出，3 列 × 2 行，1536 × 1024。
- `docs/shenshen/prompts.json`：图像生成使用的 prompt。
- `docs/shenshen/no-sway-prompts.json`：按用户反馈重制待机/敲键盘的 prompt，要求固定主体，只改变眼睛和手部。
- `scripts/build-shenshen-assets.cjs`：无重绘的 APNG 封装。
- `tests/shenshen-actions.test.mjs`：动作、状态、交互保护及接线测试。
- `tests/shenshen-stability.test.mjs`：逐像素检查待机/敲键盘主体固定，以及眼睛/手指确实有可见变化。

图片通过内置 `image_gen.imagegen` 生成，使用早期参考造型与 `transparent_background: true`。构建脚本裁出六个格子、按整像素锚点放置并封装 APNG，不缩放或重绘。待机/敲键盘以第 0 帧作为固定主体，只从其他已绘制帧复制眼睛/手指区域；这些区域记录在 manifest 的 `fixedRig.motionRects` 中。其余动作使用完整姿态帧。成品 608 × 608，站立/坐姿脚底为 y=544；跳跃保留腾空高度，末帧回到地面。`frameOffsets` 记录源格子的放置位移。

## 重建和测试

需要 Node.js >= 24。成品 APNG 已随源码提供；只有重建需要 pngjs 7.0.0（devDependency）。

```powershell
npm ci --ignore-scripts
npm run build:shenshen
node --test tests/shenshen-actions.test.mjs tests/shenshen-stability.test.mjs
```

23 个动作测试涵盖 APNG 帧数/时长、任务状态变化、通知去重、延迟解码、自定义角色、拖拽/按压保护、pointer capture 丢失以及真实角色切换事件接线。初版 12 个相关测试文件共 86 项通过。固定主体修复追加 11 个稳定性测试，先验证旧成品及不合理动区失败，再完成修复；动作、稳定性、媒体检查和点击区域共 53 项通过，git diff --check 通过。npm ci 后即可重建，无需额外 NODE_PATH 配置。

稳定性测试独立解码 APNG，检查 CRC/序号/透明边缘、6 帧均不同，眼睛和手指有可见变化。动区必须符合独立确认的眼睛/指尖位置和尺寸，扩大眼区或把胸口标作手部会被拒绝。待机动区占画布 2.19%，敲键盘占 3.07%，区域外所有 RGBA 像素逐字节相同。浏览器预览已复核固定主体的待机和工作画面。初版独立 code review 还验证了 42 帧可解码、无非零 alpha 裁切及源像素完整；固定主体修复及补强测试的独立复审已通过，无未修复阻塞项。7 个 alpha mask 共 2,587,648 字节，低于原缓存 8 MiB 限额。

## 继续二次开发

修改动作时保留同一造型和完整透明边缘。替换对应 `sources/<state>.png` 后，检查打包脚本中的六帧 `headX` 锚点与 `duration`；待机/敲键盘还需要重新确认眼睛和手指的 `motionRects`，避免裁到脸部或手套轮廓。重建并运行两组测试。若改变短动作总时长，同步更新控制器中的 `durations`；测试会检测时长不一致。

正式接入桌面后，检查原生悬浮窗口的拖拽、透明点击区域及多任务状态。深深版快速上手见 [README](README.md)，更完整的上游安装/回滚说明见 [UPSTREAM-README](UPSTREAM-README.md)；开发验证阶段未执行桌面安装。
