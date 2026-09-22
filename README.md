# UniBoot Design MCP Server

Official remote MCP server for UniBoot Design. It gives Cursor and other AI tools secure, real-time access to design files, artboards, tokens, PRDs, and design-to-code workflows.

- **Auth:** OAuth 2.1
- **Hosting:** UniBoot Cloud
- **Transport:** Streamable HTTP

## One-click setup

Pick your AI client below to install the official UniBoot Design MCP Server. Each button uses your client's native install link, so you don't need to edit any JSON config by hand.

<table>
  <tr>
    <td align="center" valign="top" width="25%">
      <a href="https://cursor.com/en/install-mcp?name=UniBoot-Design&config=eyJ1cmwiOiJodHRwczovL21jcC51YmQucGF4Y3EuY29tL21jcCJ9">
        <img src="assets/add-to-cursor.svg" alt="Add to Cursor" width="200" />
      </a>
      <br />
      <a href="https://cursor.com/en/install-mcp?name=UniBoot-Design&config=eyJ1cmwiOiJodHRwczovL21jcC51YmQucGF4Y3EuY29tL21jcCJ9"><strong>Add to Cursor</strong></a>
      <br />
      <sub>Implement screens from UniBoot Design delivery links.</sub>
    </td>
    <td align="center" valign="top" width="25%">
      <a href="https://vscode.dev/redirect/mcp/install?name=UniBoot-Design&config=%7B%22url%22%3A%22https%3A%2F%2Fmcp.ubd.paxcq.com%2Fmcp%22%2C%22type%22%3A%22http%22%7D">
        <img src="assets/add-to-vscode.svg" alt="Add to VS Code" width="200" />
      </a>
      <br />
      <a href="https://vscode.dev/redirect/mcp/install?name=UniBoot-Design&config=%7B%22url%22%3A%22https%3A%2F%2Fmcp.ubd.paxcq.com%2Fmcp%22%2C%22type%22%3A%22http%22%7D"><strong>Add to VS Code</strong></a>
      <br />
      <sub>Use design context in GitHub Copilot Chat.</sub>
    </td>
    <td align="center" valign="top" width="25%">
      <a href="https://chatgpt.com/#settings">
        <img src="assets/add-to-chatgpt.svg" alt="Add to ChatGPT" width="200" />
      </a>
      <br />
      <a href="https://chatgpt.com/#settings"><strong>Add to ChatGPT</strong></a>
      <br />
      <sub>Add <code>https://mcp.ubd.paxcq.com/mcp</code> as a connector.</sub>
    </td>
    <td align="center" valign="top" width="25%">
      <a href="https://claude.ai/settings/connectors">
        <img src="assets/add-to-claude.svg" alt="Add to Claude" width="200" />
      </a>
      <br />
      <a href="https://claude.ai/settings/connectors"><strong>Add to Claude</strong></a>
      <br />
      <sub>Connect the remote MCP server, then complete OAuth.</sub>
    </td>
  </tr>
</table>

After install, sign in when the client starts the UniBoot Design authorization flow. No API tokens to paste.

### Let your agent do the setup

```
Set up UniBoot Design MCP using https://mcp.ubd.paxcq.com/mcp.
Then start the UniBoot Design authentication flow so I can sign in.
```

Or add it with your client's own command:

| Client | Command or configuration |
| --- | --- |
| Cursor | Marketplace / **Add to Cursor**, or the button above |
| VS Code | Extensions → `@mcp UniBoot Design`, or the button above |
| Claude Code | `claude mcp add --transport http uniboot-design https://mcp.ubd.paxcq.com/mcp` |
| Codex | `codex mcp add uniboot-design --url https://mcp.ubd.paxcq.com/mcp` |
| Any other MCP client | Server URL `https://mcp.ubd.paxcq.com/mcp` |

Manual `mcp.json`:

```json
{
  "mcpServers": {
    "uniboot-design": {
      "url": "https://mcp.ubd.paxcq.com/mcp"
    }
  }
}
```

Cursor discovers OAuth 2.1 (PKCE + Dynamic Client Registration) from the remote server.

## Authorization

1. The client connects to `https://mcp.ubd.paxcq.com/mcp`. Requests without a token receive **401** plus `WWW-Authenticate` (RFC 9728).
2. The client reads `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.
3. The browser opens `/authorize`. The user signs in, picks a team, selects Read / Write / Search, and accepts.
4. The client is redirected to its OAuth callback (Cursor desktop uses `http://localhost:8787/callback`).
5. Tool calls run with that user's existing UniBoot Design permissions.

## Repository layout

| Format | Manifest | Contents |
| --- | --- | --- |
| Cursor Plugin | `.cursor-plugin/plugin.json` + `.mcp.json` | skills, rules, commands |
| Agent Plugins | `plugin.json` + `mcp.json` | portable skills + MCP |
| MCP Registry | `server.json` | remote endpoint metadata |
| `src/` | HTTP MCP + OAuth authorization server | deployed at `mcp.ubd.paxcq.com` |

## Local development

```bash
cp .env.example .env
# UniBoot Design API should already be running on :8060
npm install
npm run dev          # http://localhost:8070/mcp
```

Health check: `curl -s http://localhost:8070/health`

OAuth discovery:

```bash
curl -s http://localhost:8070/.well-known/oauth-protected-resource
curl -s http://localhost:8070/.well-known/oauth-authorization-server
```

| Variable | Description |
| --- | --- |
| `UBD_API_BASE` | API base URL. Default `http://localhost:8060/api/v1` |
| `UBD_WEB_BASE` | Web app URL. Default `http://localhost:5173` |
| `MCP_PUBLIC_URL` | Public issuer / resource URL. Production: `https://mcp.ubd.paxcq.com` |
| `MCP_PORT` | Default `8070` |
| `MCP_ALLOWED_HOSTS` | Production: `mcp.ubd.paxcq.com` |

## Tools

Primary entry: `open_delivery`. Pixel QA: `compare_design_code` (requires `screenshot` and `implementedSource`).

Also available: `list_artboards` · `get_design_page` · `get_artboard_preview` · `export_artboard_assets` · `generate_prototype` · `generate_design` · `plan_canvas_ops` · `apply_canvas_ops` · `list_prds` · `get_prd`

Users only need to paste a delivery URL and ask to implement or match the design. Skills and rules make the agent call the right tools.

## Publish to the Cursor Marketplace

1. Push this repository to a **public** Git host.
2. Confirm `.cursor-plugin/plugin.json`, `.mcp.json`, the logo, and this README are present.
3. Submit the repository URL at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).
4. After review, users install from Customize / Marketplace and complete OAuth.

Preview locally without publishing:

```bash
mkdir -p ~/.cursor/plugins/local
ln -sfn "$(pwd)" ~/.cursor/plugins/local/uniboot-design
```

Then run **Developer: Reload Window**.

## Deploy

Production MCP URL: `https://mcp.ubd.paxcq.com/mcp`. Build with the root `Dockerfile` and set:

```
UBD_API_BASE=http://api:8060/api/v1
MCP_PUBLIC_URL=https://mcp.ubd.paxcq.com
MCP_ALLOWED_HOSTS=mcp.ubd.paxcq.com
UBD_WEB_BASE=https://ubd.paxcq.com
```

Allowed OAuth redirect URIs include loopback callbacks and official client hosts (Cursor, VS Code, Claude, ChatGPT).

After deploy, `GET /health` must include `"auth":"oauth2.1"`. If Cursor logs `Cannot POST /register`, the public MCP container is still the old PAT image — rebuild `ubd-mcp` from this repo and `up mcp`. If `/.well-known/oauth-*` returns HTML `404.html`, the reverse proxy is intercepting ACME `/.well-known`; only `/.well-known/acme-challenge/` should be static, everything else must proxy to MCP.

## License

Apache-2.0
