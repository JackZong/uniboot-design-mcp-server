---
name: uniboot-design
description: >-
  When the user pastes a UniBoot Design delivery URL or asks to 落地/对齐设计稿 —
  even without naming tools — ALWAYS open_delivery first. Obey gate.pixelChecklist
  (no space-between / no sticky white footer without fill / no single shell).
  Apply keySpecs.relative + layoutIntent + cssHints; export icons; finish with
  compare_design_code including screenshot AND implementedSource. QA in same product state.
---

# UniBoot Design → 像素级代码

## 用户怎么说

> 按这个链接实现某某页，尽量贴设计图：`<URL>`

## Agent 内部（用户无感知）

1. `open_delivery` → **先读 `data.gate`**；传 `config`（`uniboot-design.json`）和/或 `packageJson`（有 element-plus 时勿套 uniboot-ui）
2. 遵守 `structureContract` + **勾完 `pixelChecklist.acceptance`**
3. toolbar/footer：**先看** `keySpecs.relative` / `box.x` / `layoutIntent`（左对齐勿 space-between）
4. **照抄 `cssHints`**；按 `iconNodeIds` 切图
5. 手写对齐仓库；**不要**默认 `execute_code_plan`（需 `confirmScaffold=true` 才是脚手架）
6. 用 `gate.acceptanceState` 同态验收（编辑态，不是 `mode=detail`）
7. **必须** `compare_design_code({ screenshot, implementedSource, implementedComponents })`
   - 无截图 = 像素未完成
   - 无 `implementedSource` = 禁令 lint 未完成

## 反例

- ❌ 合成单白壳 / 跳过 keySpecs / 用 EP 图标顶替切图
- ❌ 标题+批量默认 `space-between`
- ❌ sticky 白底圆角 footer（无 fill 时禁止）
- ❌ 用预览文案覆盖坐标
- ❌ 在只读详情态验收「缺按钮」
- ❌ compare 不带 screenshot / implementedSource
- ❌ 未确认就跑 `execute_code_plan`
