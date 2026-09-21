---
name: generate-prototype
description: >-
  Use when the user asks to generate a UniBoot Design prototype / 原型 / CRM 后台
  with MCP. Cursor generates pages locally, then uploads via generate_prototype.
  Do not hand the brief to the UniBoot platform LLM.
---

# 用 MCP 生成原型

1. 先 `generate_prototype`（不带 `pages[]`）拿到 `awaiting_pages` 简报
2. **在 Cursor 本地**生成 HTML / 线框 `pages[]`
3. 再带 `projectId` + `pages[]` 重调 `generate_prototype` 上传
4. 把返回的 **editorUrl**（`/ai/{projectId}?capability=prototype`）发给用户并停止

不要 `resolve_link`，不要打开设计编辑器或产品 Tab，不要把描述交给平台 AI。
