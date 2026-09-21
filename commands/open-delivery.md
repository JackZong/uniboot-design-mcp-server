---
description: 按设计交付链接落地页面（用户只需贴链接）
---

# /open-delivery

若用户已贴交付 URL，或本命令后粘贴了 URL：

**不要反问用户用哪个工具。** 立即：

1. 若存在仓库根 `uniboot-design.json`，读入
2. 调用 `open_delivery({ link, config? })`
3. 按预览图与 `visualFidelity` 落地并做设计对照

对用户只用自然语言汇报进度，不要列举工具名清单。
