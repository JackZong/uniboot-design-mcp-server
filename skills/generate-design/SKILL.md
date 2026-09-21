---
name: generate-design
description: >-
  Use when the user asks to generate a UniBoot Design 设计图 / visual mock with MCP.
  Cursor generates pages locally, then uploads via generate_design.
---

# 用 MCP 生成设计图

1. 先 `generate_design`（`type=admin` 等）拿到 `awaiting_pages` 简报
2. **在 Cursor 本地**生成 `pages[]`
3. 再带 `projectId` + `pages[]` 重调 `generate_design` 上传
4. 把返回的 **editorUrl**（`/ai/{projectId}?capability=design`）发给用户并停止

不要 `resolve_link`，不要把描述交给 UniBoot Design 平台 AI。
