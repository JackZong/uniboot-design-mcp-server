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
  /** When set, show a link to reuse the UniBoot Design web session. */
  ssoContinueUrl?: string
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

  const clientName = opts.clientName.trim() || 'Client'
  const clientInitial = escapeHtml((clientName.slice(0, 1) || 'A').toUpperCase())
  const isCursor = /^cursor$/i.test(clientName)
  const appIcon = isCursor
    ? `<img src="/assets/cursor-logo.png" alt="${escapeHtml(clientName)}" />`
    : clientInitial
  const scopeCount = opts.scopes.length

  const scopeBoxes = opts.scopes
    .map((id) => {
      const def = SCOPE_DEFS[id]
      return `
        <label class="perm-card">
          <input type="checkbox" name="scope" value="${id}" checked />
          <span class="perm-copy">
            <span class="perm-title">${escapeHtml(def.title)}</span>
            <span class="perm-desc">${escapeHtml(def.description)}</span>
          </span>
          <span class="perm-chevron" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4.5 6.25 8 9.75l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </label>`
    })
    .join('')

  const userInitial = loggedIn
    ? escapeHtml((opts.user!.name || opts.user!.email).slice(0, 1).toUpperCase())
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize UniBoot Design</title>
  <link rel="icon" href="/assets/logo.svg" />
  <style>
    :root {
      --blue: #0C66E4;
      --blue-hover: #0055CC;
      --blue-pressed: #09326C;
      --ink: #172B4D;
      --text: #292A2E;
      --muted: #626F86;
      --subtle: #8590A2;
      --line: #DCDFE4;
      --line-strong: #B3B9C4;
      --bg: #F7F8F9;
      --surface: #FFFFFF;
      --danger: #AE2E24;
      --danger-bg: #FFEDEB;
      --chip: #E9F2FF;
      --chip-text: #0C66E4;
      --radius: 8px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      color: var(--text);
      font-family: var(--font);
      background: var(--surface);
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .topbar {
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--ink);
      font-weight: 700;
      letter-spacing: 0.04em;
      font-size: 13px;
    }
    .brand img { width: 22px; height: 22px; }
    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #E9F2FF;
      color: var(--blue);
      display: grid;
      place-items: center;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid #C6DEF8;
    }

    form.page {
      min-height: calc(100vh - 56px);
      display: flex;
      flex-direction: column;
    }
    .wrap {
      flex: 1;
      display: grid;
      grid-template-columns: minmax(320px, 1fr) minmax(360px, 1.15fr);
      max-width: 1120px;
      width: 100%;
      margin: 0 auto;
      padding: 40px 40px 24px;
      gap: 48px;
    }

    .bridge {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 28px;
    }
    .app-icon, .ubd-icon {
      width: 48px;
      height: 48px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .app-icon {
      color: #fff;
      font-size: 22px;
      font-weight: 700;
      overflow: hidden;
    }
    .app-icon img {
      width: 36px;
      height: 36px;
      object-fit: contain;
      display: block;
    }
    .ubd-icon {
      background: var(--surface);
      border: 1px solid var(--line);
    }
    .ubd-icon img { width: 26px; height: 26px; }
    .bridge-arrow {
      color: var(--subtle);
      display: grid;
      place-items: center;
    }

    h1 {
      margin: 0 0 28px;
      font-size: 28px;
      line-height: 1.25;
      font-weight: 600;
      color: var(--ink);
      letter-spacing: -0.01em;
      max-width: 16ch;
    }

    .info-card {
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
      background: var(--surface);
    }
    .info-visual {
      height: 168px;
      background:
        radial-gradient(circle at 50% 55%, rgba(12, 102, 228, 0.12), transparent 42%),
        linear-gradient(180deg, #F4F7FB 0%, #EEF3F9 100%);
      display: grid;
      place-items: center;
      position: relative;
    }
    .orbit {
      width: 112px;
      height: 112px;
      border-radius: 50%;
      border: 1px dashed #C6DEF8;
      display: grid;
      place-items: center;
      position: relative;
    }
    .orbit-core {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      background: var(--surface);
      border: 1px solid var(--line);
      display: grid;
      place-items: center;
      box-shadow: 0 8px 20px rgba(23, 43, 77, 0.08);
    }
    .orbit-core img { width: 28px; height: 28px; }
    .sat {
      position: absolute;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: var(--surface);
      border: 1px solid var(--line);
      display: grid;
      place-items: center;
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      box-shadow: 0 2px 6px rgba(23, 43, 77, 0.06);
    }
    .sat-1 { top: -6px; left: 42px; }
    .sat-2 { right: -8px; top: 40px; color: #DE350B; }
    .sat-3 { bottom: -4px; left: 40px; color: #36B37E; }
    .sat-4 { left: -10px; top: 38px; color: #6554C0; }
    .info-body { padding: 18px 20px 20px; }
    .info-body h3 {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 600;
      color: var(--ink);
    }
    .info-body p {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }
    .learn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 500;
    }

    .right h2 {
      margin: 0 0 18px;
      font-size: 20px;
      font-weight: 600;
      color: var(--ink);
    }
    .error {
      background: var(--danger-bg);
      color: var(--danger);
      border: 1px solid #FFD2CC;
      padding: 10px 12px;
      border-radius: var(--radius);
      margin-bottom: 16px;
      font-size: 14px;
    }
    .section { margin-bottom: 28px; }
    .section-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .details {
      display: grid;
      gap: 14px;
    }
    .detail-row {
      display: grid;
      grid-template-columns: 88px 1fr;
      gap: 12px;
      align-items: start;
      font-size: 14px;
    }
    .detail-row dt {
      margin: 0;
      color: var(--muted);
      font-weight: 500;
    }
    .detail-row dd {
      margin: 0;
      color: var(--text);
      word-break: break-all;
    }

    .login-grid { display: grid; gap: 14px; margin-bottom: 8px; }
    .field {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 6px;
    }
    input[type=email], input[type=password], select {
      width: 100%;
      height: 40px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      padding: 0 12px;
      font-size: 14px;
      font-family: inherit;
      background: var(--surface);
      color: var(--text);
    }
    input:focus, select:focus {
      outline: none;
      border-color: var(--blue);
      box-shadow: 0 0 0 2px rgba(12, 102, 228, 0.2);
    }
    .user-line {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 14px;
      color: var(--muted);
    }
    .user-line strong { color: var(--text); font-weight: 600; }

    .site-box {
      min-height: 40px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      padding: 6px 10px;
      display: flex;
      align-items: center;
      background: var(--surface);
    }
    .site-box select {
      border: 0;
      box-shadow: none;
      height: 28px;
      padding: 0;
      background: transparent;
    }
    .site-box select:focus { box-shadow: none; }
    .site-hint {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .site-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--chip);
      color: var(--chip-text);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 13px;
      font-weight: 600;
      max-width: 100%;
    }

    .perm-list { display: grid; gap: 10px; }
    .perm-card {
      display: grid;
      grid-template-columns: 20px 1fr 16px;
      gap: 12px;
      align-items: start;
      padding: 14px 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      cursor: pointer;
      transition: border-color .12s ease, box-shadow .12s ease;
    }
    .perm-card:hover {
      border-color: #B3D4FF;
      box-shadow: 0 1px 0 rgba(12, 102, 228, 0.04);
    }
    .perm-card input {
      margin-top: 2px;
      width: 16px;
      height: 16px;
      accent-color: var(--blue);
    }
    .perm-title {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: var(--ink);
      margin-bottom: 4px;
    }
    .perm-desc {
      display: block;
      font-size: 13px;
      line-height: 1.5;
      color: var(--muted);
    }
    .perm-chevron {
      color: var(--subtle);
      margin-top: 2px;
    }

    footer.bar {
      position: sticky;
      bottom: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 16px 40px;
      border-top: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(8px);
    }
    .legal {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
      max-width: 52ch;
    }
    .actions { display: flex; gap: 8px; flex-shrink: 0; }
    button, .btn {
      height: 36px;
      border: 0;
      border-radius: var(--radius);
      padding: 0 14px;
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .ghost {
      background: transparent;
      color: var(--muted);
    }
    .ghost:hover { background: var(--bg); color: var(--ink); text-decoration: none; }
    .primary {
      background: var(--blue);
      color: #fff;
      min-width: 88px;
    }
    .primary:hover { background: var(--blue-hover); }
    .primary:active { background: var(--blue-pressed); }

    @media (max-width: 900px) {
      .wrap {
        grid-template-columns: 1fr;
        padding: 24px 20px;
        gap: 28px;
      }
      h1 { max-width: none; font-size: 24px; }
      footer.bar {
        flex-direction: column;
        align-items: stretch;
        padding: 14px 20px 20px;
      }
      .actions { justify-content: flex-end; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><img src="/assets/logo.svg" alt="" /> UNIBOOT DESIGN</div>
    ${loggedIn ? `<div class="avatar" title="${escapeHtml(opts.user!.email)}">${userInitial}</div>` : `<div></div>`}
  </header>

  <form method="post" action="/authorize" class="page">
    ${hidden}
    <div class="wrap">
      <section class="left">
        <div class="bridge" aria-hidden="true">
          <div class="app-icon">${appIcon}</div>
          <div class="bridge-arrow">
            <svg width="28" height="16" viewBox="0 0 28 16" fill="none">
              <path d="M1 8h26M19 2l7 6-7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="ubd-icon"><img src="/assets/logo.svg" alt="UniBoot Design" /></div>
        </div>
        <h1>${escapeHtml(clientName)} is requesting access to your UniBoot Design account</h1>
        <div class="info-card">
          <div class="info-visual">
            <div class="orbit">
              <span class="sat sat-1">AI</span>
              <span class="sat sat-2">UI</span>
              <span class="sat sat-3">PRD</span>
              <span class="sat sat-4">QA</span>
              <div class="orbit-core"><img src="/assets/logo.svg" alt="" /></div>
            </div>
          </div>
          <div class="info-body">
            <h3>What is an MCP server?</h3>
            <p>MCP servers are the standard way to safely empower agents to access your data. In this step we will help you define exactly what your agent can and cannot do.</p>
            <a class="learn" href="https://ubd.paxcq.com" target="_blank" rel="noopener">
              Learn more
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </a>
          </div>
        </div>
      </section>

      <section class="right">
        <h2>Details</h2>
        ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ''}

        ${
          loggedIn
            ? `<div class="user-line">Signed in as <strong>${escapeHtml(opts.user!.name)}</strong> · ${escapeHtml(opts.user!.email)}</div>`
            : `<div class="section">
                ${
                  opts.ssoContinueUrl
                    ? `<p class="site-hint" style="margin-bottom:12px">Already signed in on UniBoot Design?
                        <a href="${escapeHtml(opts.ssoContinueUrl)}">Continue with that account</a>
                      </p>`
                    : ''
                }
                <div class="login-grid">
                  <div>
                    <label class="field" for="email">Email</label>
                    <input id="email" name="email" type="email" autocomplete="username" required />
                  </div>
                  <div>
                    <label class="field" for="password">Password</label>
                    <input id="password" name="password" type="password" autocomplete="current-password" required />
                  </div>
                </div>
              </div>`
        }

        <div class="section">
          <dl class="details">
            <div class="detail-row">
              <dt>Name</dt>
              <dd>${escapeHtml(clientName)}</dd>
            </div>
            <div class="detail-row">
              <dt>Domains</dt>
              <dd>${escapeHtml(opts.redirectUri)}</dd>
            </div>
          </dl>
        </div>

        <div class="section">
          <label class="section-label" for="teamId">Site (team workspace)</label>
          ${
            loggedIn && teams.length
              ? `<div class="site-box">
                  <span class="site-chip">Team</span>
                  <select id="teamId" name="teamId">${teamOptions}</select>
                </div>`
              : `<p class="site-hint">${
                  loggedIn
                    ? 'No team is available for this account yet.'
                    : 'Choose a team after you sign in.'
                }</p>`
          }
        </div>

        <div class="section">
          <span class="section-label">Permissions</span>
          <div class="perm-list">${scopeBoxes}</div>
        </div>
      </section>
    </div>

    <footer class="bar">
      <div class="legal">
        ${scopeCount} out of ${scopeCount} permissions selected.
        By accepting, you agree to UniBoot Design terms of use.
      </div>
      <div class="actions">
        <a class="btn ghost" href="${escapeHtml(denyUrl(opts.query))}">Cancel</a>
        <button class="primary" type="submit">${loggedIn ? 'Accept' : 'Sign in & Accept'}</button>
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
