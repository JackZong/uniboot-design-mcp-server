# UniBoot Design MCP skills

这些 skill 面向远程 MCP 端点 `https://mcp.ubd.paxcq.com/mcp`。Cursor / Agent Plugins 会按 `skills/<name>/SKILL.md` 自动发现。

| Skill | 何时使用 |
| --- | --- |
| `uniboot-design` | 用户粘贴交付链接，或说落地 / 对齐设计 |
| `generate-prototype` | 用 MCP 生成可预览原型 |
| `generate-design` | 用 MCP 生成设计图 |

授权使用 **OAuth 2.1**（与 Atlassian MCP 相同：连接时浏览器同意）。无头环境可改用 PAT：`Authorization: Bearer ubd_pat_...`。
