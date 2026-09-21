# UniBoot Design MCP Server

**Official remote MCP server for UniBoot Design** — a cloud-hosted bridge that gives Cursor and other AI tools secure, real-time access to your design files, artboards, tokens, PRDs, and code-from-design workflows.

Auth: **OAuth 2.1** (same model as [Atlassian MCP Server](https://github.com/atlassian/atlassian-mcp-server)) or PAT · Hosting: UniBoot Cloud · Transport: Streamable HTTP

## One-click setup

[**Add to Cursor**](https://cursor.com/en/install-mcp?name=UniBoot-Design&config=eyJ1cmwiOiJodHRwczovL21jcC51YmQucGF4Y3EuY29tL21jcCJ9)

或从 [Cursor Marketplace](https://cursor.com/marketplace) 搜索 **UniBoot Design** → **Add to Cursor**。装好后 Agent 会拉起浏览器授权，登录 UniBoot Design 账号并点 **接受**。

手动配置：

```json
{
  "mcpServers": {
    "uniboot-design": {
      "url": "https://mcp.ubd.paxcq.com/mcp"
    }
  }
}
```

不要再填 `UBD_PAT`。Cursor 会按 MCP 规范自动走 OAuth 2.1（PKCE + Dynamic Client Registration）。

## 授权模式（对齐 Atlassian）

1. 客户端连接 `https://mcp.ubd.paxcq.com/mcp`，未带 token 时返回 **401** + `WWW-Authenticate`（RFC 9728）。
2. 发现 `/.well-known/oauth-protected-resource` 与 `/.well-known/oauth-authorization-server`。
3. 浏览器打开 `/authorize`：登录 UniBoot Design → 选择团队 → 勾选 Read / Write / Search → **接受**。
4. 回调 Cursor（`http://localhost:8787/callback` 或 `https://www.cursor.com/agents/mcp/oauth/callback`）。
5. 之后每次 tool 调用都用你的账号权限（内部签发 PAT，API 侧权限不变）。

无头 / CI 仍可用 PAT：

```http
Authorization: Bearer ubd_pat_...
```

## 仓库结构（Atlassian 同款打包）

| 格式 | 清单 | 内容 |
| --- | --- | --- |
| Cursor Plugin | `.cursor-plugin/plugin.json` + `.mcp.json` | skills / rules / commands |
| Agent Plugins | `plugin.json` + `mcp.json` | 可移植 skills + MCP |
| MCP Registry | `server.json` | 远程端点元数据 |
| 本仓库 `src/` | HTTP MCP + OAuth AS | 部署到 `mcp.ubd.paxcq.com` |

## 本地开发

```bash
cp .env.example .env
# 确保 UniBoot Design API 已在 :8060 运行
pnpm install
pnpm dev          # http://localhost:8070/mcp
```

健康检查：`curl -s http://localhost:8070/health`

OAuth 发现：

```bash
curl -s http://localhost:8070/.well-known/oauth-protected-resource
curl -s http://localhost:8070/.well-known/oauth-authorization-server
```

环境变量：

| 变量 | 说明 |
| --- | --- |
| `UBD_API_BASE` | API，默认 `http://localhost:8060/api/v1` |
| `UBD_WEB_BASE` | 交付台，默认 `http://localhost:5173` |
| `MCP_PUBLIC_URL` | 对外 issuer / resource，生产为 `https://mcp.ubd.paxcq.com` |
| `MCP_PORT` | 默认 `8070` |
| `MCP_ALLOWED_HOSTS` | 生产设为 `mcp.ubd.paxcq.com` |
| `UBD_PAT` | 可选，跳过 OAuth 的本地 fallback |

## 工具

主入口：`open_delivery`。像素验收：`compare_design_code`（必须带 screenshot + implementedSource）。

其它：`list_artboards` · `get_design_page` · `get_artboard_preview` · `export_artboard_assets` · `generate_prototype` · `generate_design` · `plan_canvas_ops` · `apply_canvas_ops` · `list_prds` · `get_prd` …

用户只需贴交付链接并说「落地 / 对齐设计」。Skill / Rule 会让 Agent 自动调用工具。

## 发布到 Cursor Marketplace

1. 把本仓库推到**公开** Git 仓库（GitHub 等）。
2. 确认 `.cursor-plugin/plugin.json`、`.mcp.json`、logo、README 齐全。
3. 打开 [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) 提交仓库链接。
4. 审核通过后，用户在 Customize / Marketplace 一键安装并完成 OAuth。

本地预览插件（不上架）：

```bash
mkdir -p ~/.cursor/plugins/local
ln -sfn "$(pwd)" ~/.cursor/plugins/local/uniboot-design
```

然后 **Developer: Reload Window**。

## 部署

生产 MCP 地址：`https://mcp.ubd.paxcq.com/mcp`。用仓库根目录 `Dockerfile` 构建，并设置：

```
UBD_API_BASE=http://api:8060/api/v1
MCP_PUBLIC_URL=https://mcp.ubd.paxcq.com
MCP_ALLOWED_HOSTS=mcp.ubd.paxcq.com
UBD_WEB_BASE=https://ubd.paxcq.com
```

OAuth 回调必须允许：

- `http://localhost:8787/callback`（Cursor 桌面）
- `https://www.cursor.com/agents/mcp/oauth/callback`（Cursor Web / Agents）

## License

Apache-2.0
