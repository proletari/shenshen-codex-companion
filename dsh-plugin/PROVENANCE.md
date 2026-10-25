# 素材来源与许可范围（PROVENANCE）

本仓库的**代码**按 MIT 许可（见 [`LICENSE`](LICENSE)）。`assets/` 目录下的**美术素材**（图片 / 动图 / 音效）**不在 MIT 覆盖范围内**，按下面的说明「原样提供」。

## 〇、本分支的来源链

| 环节 | 内容 |
|---|---|
| 上游代码与素材 | [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（`dsh-whale-widget` 0.4.2）：余额、记账、角色、气泡、音效、工坊 |
| 深深角色与动作 | [proletari/shenshen-codex-companion](https://github.com/proletari/shenshen-codex-companion)：7 组 42 帧 APNG、`shenshen-manifest.json`、生成 prompt |
| 奔跑动画 | 用户本机 Codex 自定义宠物 `shenshen-orange-codex` 的 `spritesheet.webp`：图集第 1/2 行（向右/向左跑动，各 8 帧），缩放后接入本插件 |
| 本分支新增 | 状态折叠（`lib/shenshen-state.mjs`）、动作 sidecar（`assets/shenshen-actions.js`）、状态/素材路由与两条注入行；行为参考 Codex 版的 `desktop/ui/shenshen-actions.js`，但按 DSH 的 DOM 与 API 重写 |

深深版**不修改**上游 `lib/index.js` 与 `assets/whale-widget.js` 的核心逻辑（只把默认角色名改为「深深」，并追加路由与注入），因此上游的功能与已知问题一并继承。

## 一、许可范围

| 范围 | 许可 |
|---|---|
| `lib/`、`cordis.patch.yml`、`package.json`、文档与维护脚本 | **MIT**（见 `LICENSE`） |
| `assets/shenshen-actions.js`、`lib/shenshen-state.mjs` | **MIT**（本分支新增代码） |
| `icon.png`（插件列表图标） | **不适用 MIT**：与 `assets/` 下的美术素材同属"原样提供"，仅用于标识本插件；不授予再许可，也不声明为原创作品。 |
| `assets/**`（图片 / 动图 / 音效） | **不适用 MIT**：由维护者提供或使用 AI 工具生成，按 **as-is** 随插件分发，仅用于运行本插件；不授予再许可，也不声明为原创作品。 |

这样划分的原因：代码可以明确授权，而美术素材的来源与权利状态往往无法百分之百举证 —— 与其给一个站不住的授权，不如如实标注范围，并承诺收到权利主张就处理（见第四节）。

## 二、逐项来源

| 文件 | 来源 / 说明 |
|---|---|
| `DSniang1.png`（鲸鱼本体，气泡由代码绘制） | **AI 工具生成**的图像，经人工挑选与裁切。生成工具与原始出处**已不可考**（文件内元数据已被剥离，见第三节）。 |
| `icon.png`（插件列表图标，256×256 PNG 含透明） | 由 `assets/shenshen-idle.png` 第 0 帧按 alpha 裁切、居中、缩放到 256×256（深深素材，来源见上表）。 |
| `DSniang02.png` | 同上（备用整图，兼容旧版手动安装路径）。 |
| `DSH2.png`（README 顶部展示图） | 由维护者自行设计与排版（使用在线设计工具），2026-09 替换为清理版（已剥离全部内嵌元数据）。 |
| `rua.gif`、`bubble-petpet.gif` | 内置动图素材。 |
| `bubble-money1.gif` | 内置泡泡图（余额预警默认内容的配图）。 |
| `Ya1.mp3` / `Ya2.mp3`、`D1.mp3` / `D2.mp3` | 内置音效（按压 / 松开）。 |
| `task-end-a.wav` | 内置任务结束音（预设 A）。公开版已移除 Minecraft 音效（第三方 IP），不再随包分发。 |
| `shenshen-*.png`（7 组 APNG） | 来自 [proletari/shenshen-codex-companion](https://github.com/proletari/shenshen-codex-companion)。AI 工具生成，生成 prompt 与固定主体（no-sway）重制记录见 `docs/shenshen/prompts.json` 与 `docs/shenshen/no-sway-prompts.json`。按 as-is 随插件分发。 |
| `shenshen-runright.png` / `shenshen-runleft.png` | 取自用户本机 Codex 自定义宠物 `shenshen-orange-codex`（`~/.codex/pets/shenshen-orange-codex/spritesheet.webp`）第 1/2 行各 8 帧跑步动画，按 192×208 单元格等比放大到 608×608；与 608 版 APNG 为同一角色的不同生成批次。 |
| `shenshen-mask*.png` | 各动作所有帧的 alpha 并集，仅用于命中判定与裁切轮廓，不参与显示。 |
| `docs/preview.jpg`、`docs/shenshen/*.json` | 同上，仅用于展示与生成过程追溯。 |
| `assets/shenshen-actions.js`、`lib/shenshen-state.mjs` | 本分支新增的**代码**，MIT。 |

## 三、元数据清理

图片素材曾内嵌过设计工具的 XMP 归属信息（工具名、模板名、账号 id，甚至第三方品牌名）。自 **0.3.1** 起，随包 PNG **一律剥离** `eXIf` / `iTXt` / `tEXt` / `zTXt` 元数据块，只保留渲染必需的 `IHDR` / `sRGB` / `gAMA` / `pHYs` / `IDAT` / `IEND`。

- 复核：解析每个 PNG 的块序列，确认不再有文本 / EXIF 块；
- 剥离：逐块重写，不触碰像素数据（IHDR/IDAT/IEND 原样保留），因此画面完全不变。

## 四、权利主张 / Takedown

如果你认为 `assets/` 中有素材侵犯了你的权利，请在本仓库开一条 issue，说明**文件名**与**依据**，我们会在核实后**立即替换或移除**，不附加其它条件。我们也欢迎直接提供可自由再分发的替代素材。
