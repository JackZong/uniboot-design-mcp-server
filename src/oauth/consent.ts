import { SCOPE_DEFS, type ScopeId } from './scopes.js'

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderConsentPage(opts: {
  clientName: string
  redirectUri: string
  query: Record<string, string>
  user?: { name: string; email: string } | null
  teams?: Array<{ id: string; name: string }>
  scopes: ScopeId[]
  error?: string
}) {
  const hidden = Object.entries(opts.query)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`,
    )
    .join('\n')
  const loggedIn = Boolean(opts.user)
  const teams = opts.teams ?? []
  const teamOptions = teams
    .map(
      (t, i) =>
        `<option value="${escapeHtml(t.id)}"${i === 0 ? ' selected' : ''}>${escapeHtml(t.name)}</option>`,
    )
    .join('')

  const scopeBoxes = opts.scopes
    .map((id) => {
      const def = SCOPE_DEFS[id]
      return `
        <label class="perm">
          <input type="checkbox" name="scope" value="${id}" checked />
          <span>
            <strong>${escapeHtml(def.titleZh)} · ${escapeHtml(def.title)}</strong>
            <small>${escapeHtml(def.descriptionZh)}</small>
          </span>
        </label>`
    })
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>授权 UniBoot Design</title>
  <link rel="icon" href="/assets/logo.svg" />
  <style>
    :root {
      --blue: #2F54EB;
      --blue-deep: #1D39C4;
      --ink: #1d1d1f;
      --muted: #6b7280;
      --line: #e5e7eb;
      --bg: #f8fafc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--ink);
      background: #fff;
    }
    header {
      height: 56px;
      display: flex;
      align-items: center;
      padding: 0 28px;
      border-bottom: 1px solid var(--line);
      font-weight: 700;
      letter-spacing: .04em;
      color: var(--blue-deep);
    }
    header img { width: 22px; height: 22px; margin-right: 10px; }
    .wrap {
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: calc(100vh - 56px - 72px);
    }
    .pane { padding: 56px 64px; }
    .right { border-left: 1px solid var(--line); background: #fff; }
    .brands { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
    .brands img { width: 48px; height: 48px; }
    .eq { font-size: 22px; color: var(--muted); }
    h1 { font-size: 28px; line-height: 1.25; margin: 0 0 28px; }
    .card {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 18px 20px;
      background: var(--bg);
    }
    .card h3 { margin: 0 0 8px; font-size: 15px; }
    .card p, .card a { color: var(--muted); font-size: 14px; line-height: 1.6; }
    h2 { font-size: 22px; margin: 0 0 18px; }
    .row { margin-bottom: 18px; }
    .row label.field { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    input[type=email], input[type=password], select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 14px;
    }
    .perm {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 0;
      border-bottom: 1px solid var(--line);
    }
    .perm:last-child { border-bottom: 0; }
    .perm small { display: block; color: var(--muted); font-size: 13px; margin-top: 4px; }
    .error {
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px;
    }
    footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 64px;
      border-top: 1px solid var(--line);
    }
    .hint { color: var(--muted); font-size: 13px; }
    .actions { display: flex; gap: 10px; }
    button, .btn {
      border: 0;
      border-radius: 8px;
      padding: 10px 18px;
      font-size: 14px;
      cursor: pointer;
      text-decoration: none;
    }
    .ghost { background: #fff; color: var(--ink); }
    .primary { background: var(--blue); color: #fff; }
    .primary:hover { background: var(--blue-deep); }
    @media (max-width: 900px) {
      .wrap { grid-template-columns: 1fr; }
      .right { border-left: 0; border-top: 1px solid var(--line); }
      .pane, footer { padding: 28px 20px; }
    }
  </style>
</head>
<body>
  <header><img src="/assets/logo.svg" alt="" /> UNIBOOT DESIGN</header>
  <form method="post" action="/authorize">
    ${hidden}
    <div class="wrap">
      <section class="pane">
        <div class="brands">
          <div class="eq" aria-hidden="true">${escapeHtml(opts.clientName.slice(0, 1).toUpperCase() || 'C')} =</div>
          <img src="/assets/logo.svg" alt="UniBoot Design" />
        </div>
        <h1>${escapeHtml(opts.clientName)} is requesting access to your UniBoot Design account</h1>
        <div class="card">
          <h3>What is an MCP server?</h3>
          <p>MCP servers are the standard way to safely empower agents to access your data. In this step we will help you define exactly what your agent can and cannot do.</p>
        </div>
      </section>
      <section class="pane right">
        <h2>Details</h2>
        ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ''}
        ${
          loggedIn
            ? `<p class="hint" style="margin-top:-8px;margin-bottom:18px;">已登录为 ${escapeHtml(opts.user!.name)}（${escapeHtml(opts.user!.email)}）</p>`
            : `<div class="row">
                <label class="field" for="email">邮箱</label>
                <input id="email" name="email" type="email" autocomplete="username" required />
              </div>
              <div class="row">
                <label class="field" for="password">密码</label>
                <input id="password" name="password" type="password" autocomplete="current-password" required />
              </div>`
        }
        <div class="row">
          <label class="field">Name</label>
          <div>${escapeHtml(opts.clientName)}</div>
        </div>
        <div class="row">
          <label class="field">Domains</label>
          <div>${escapeHtml(opts.redirectUri)}</div>
        </div>
        <div class="row">
          <label class="field" for="teamId">Site（团队）</label>
          ${
            loggedIn && teams.length
              ? `<select id="teamId" name="teamId">${teamOptions}</select>`
              : `<p class="hint">${loggedIn ? '当前账号还没有团队。' : '登录后可选择团队。'}</p>`
          }
        </div>
        <div class="row">
          <label class="field">Permissions</label>
          ${scopeBoxes}
        </div>
      </section>
    </div>
    <footer>
      <div class="hint">By accepting, you agree to UniBoot Design terms of use.</div>
      <div class="actions">
        <a class="btn ghost" href="${escapeHtml(denyUrl(opts.query))}">取消</a>
        <button class="primary" type="submit">${loggedIn ? '接受' : '登录并接受'}</button>
      </div>
    </footer>
  </form>
</body>
</html>`
}

function denyUrl(query: Record<string, string>) {
  const redirect = query.redirect_uri
  if (!redirect) return '/'
  try {
    const u = new URL(redirect)
    u.searchParams.set('error', 'access_denied')
    if (query.state) u.searchParams.set('state', query.state)
    return u.toString()
  } catch {
    return '/'
  }
}
