import http from 'http';
import { Pool } from 'pg';
import { config } from '../config';

/**
 * Minimal admin dashboard + JSON API (no framework, no extra deps).
 *
 * - Reddit-colored theme with a light/dark toggle (persisted in localStorage,
 *   defaults to the OS preference).
 * - Mobile-first: fluid single-column layout, 16px base font (prevents iOS
 *   input zoom), 44px+ tap targets, sticky header, safe-area padding.
 * - Optional auth: set ADMIN_TOKEN and open /?token=<value> once; the token
 *   is remembered by the page and sent on every API call.
 */
export function startWebServer(pool: Pool): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (path === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      // Auth gate (applies to everything except /healthz)
      if (config.adminToken) {
        const token = url.searchParams.get('token') ?? req.headers['x-admin-token'];
        if (token !== config.adminToken) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('Unauthorized. Append ?token=<ADMIN_TOKEN> to the URL.');
          return;
        }
      }

      if (path === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(DASHBOARD_HTML);
        return;
      }

      if (path === '/api/matches' && req.method === 'GET') {
        const status = url.searchParams.get('status');
        const { rows } = await pool.query(
          status
            ? `SELECT m.id, m.subreddit_name, m.post_title, m.post_body, m.post_url, m.author,
                      m.matched_keyword, m.status, m.ai_draft_response, m.found_at, b.name AS business_name
               FROM matches m JOIN businesses b ON b.id = m.business_id
               WHERE m.status = $1 ORDER BY m.found_at DESC LIMIT 100`
            : `SELECT m.id, m.subreddit_name, m.post_title, m.post_body, m.post_url, m.author,
                      m.matched_keyword, m.status, m.ai_draft_response, m.found_at, b.name AS business_name
               FROM matches m JOIN businesses b ON b.id = m.business_id
               WHERE m.status IN ('new', 'emailed') ORDER BY m.found_at DESC LIMIT 100`,
          status ? [status] : []
        );
        json(res, rows);
        return;
      }

      const matchStatus = path.match(/^\/api\/matches\/(\d+)\/status$/);
      if (matchStatus && req.method === 'POST') {
        const body = await readJson(req);
        const status = String(body.status ?? '');
        if (!['responded', 'ignored', 'new'].includes(status)) {
          json(res, { error: 'status must be responded|ignored|new' }, 400);
          return;
        }
        await pool.query(`UPDATE matches SET status = $1 WHERE id = $2`, [status, matchStatus[1]]);
        json(res, { ok: true });
        return;
      }

      if (path === '/api/suggestions' && req.method === 'GET') {
        const { rows } = await pool.query(
          `SELECT s.id, s.subreddit_name, s.post_title, s.post_body, s.key_rules_summary,
                  s.unverified_flags, s.chosen_reason, s.status, s.created_at, b.name AS business_name
           FROM post_suggestions s JOIN businesses b ON b.id = s.business_id
           ORDER BY s.created_at DESC LIMIT 30`
        );
        json(res, rows);
        return;
      }

      const suggStatus = path.match(/^\/api\/suggestions\/(\d+)\/status$/);
      if (suggStatus && req.method === 'POST') {
        const body = await readJson(req);
        const status = String(body.status ?? '');
        if (!['posted', 'skipped'].includes(status)) {
          json(res, { error: 'status must be posted|skipped' }, 400);
          return;
        }
        await pool.query(`UPDATE post_suggestions SET status = $1 WHERE id = $2`, [status, suggStatus[1]]);
        json(res, { ok: true });
        return;
      }

      if (path === '/api/runs' && req.method === 'GET') {
        const { rows } = await pool.query(
          `SELECT id, started_at, finished_at, posts_checked, new_matches, drafts_created, errors
           FROM scan_runs ORDER BY id DESC LIMIT 20`
        );
        json(res, rows);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      console.error('[web]', err);
      json(res, { error: (err as Error).message }, 500);
    }
  });

  server.listen(config.port, () => {
    console.log(`[web] dashboard listening on port ${config.port}`);
  });
  return server;
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Reddit Marketer</title>
<style>
  :root {
    --orange: #FF4500;
    --blue: #0079D3;
    --bg: #DAE0E6;
    --card: #FFFFFF;
    --text: #1A1A1B;
    --muted: #7C7C7C;
    --border: #EDEFF1;
    --draft-bg: #FFF3EE;
    --draft-border: #FFD9C7;
    --warn-bg: #FFF8E5;
    --warn-text: #8A6D00;
    --flag-bg: #FDF1F1;
    --flag-border: #F5C6C6;
    --chip-bg: #F6F7F8;
  }
  [data-theme="dark"] {
    --bg: #030303;
    --card: #1A1A1B;
    --text: #D7DADC;
    --muted: #818384;
    --border: #343536;
    --draft-bg: #2A211C;
    --draft-border: #5A3A2A;
    --warn-bg: #2A2410;
    --warn-text: #D3BC5F;
    --flag-bg: #2A1A1A;
    --flag-border: #5A3030;
    --chip-bg: #272729;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    padding-bottom: env(safe-area-inset-bottom);
  }
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--card);
    border-bottom: 1px solid var(--border);
    padding: 10px max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left));
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header h1 { font-size: 18px; margin: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  header h1 .dot { color: var(--orange); }
  #themeToggle {
    min-width: 44px; min-height: 44px;
    border: 1px solid var(--border);
    background: var(--chip-bg);
    color: var(--text);
    border-radius: 999px;
    font-size: 18px;
    cursor: pointer;
  }
  nav {
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    max-width: 900px;
    margin: 0 auto;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  nav button {
    flex-shrink: 0;
    min-height: 44px;
    padding: 0 18px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  nav button.active { background: var(--orange); border-color: var(--orange); color: #fff; }
  main { max-width: 900px; margin: 0 auto; padding: 4px 12px 40px; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 14px; }
  .filters button {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--chip-bg);
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
  }
  .filters button.active { background: var(--blue); border-color: var(--blue); color: #fff; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 12px;
    word-break: break-word;
  }
  .card.suggestion { border: 2px solid var(--orange); }
  .card h3 { margin: 0 0 6px; font-size: 16px; line-height: 1.35; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 10px; }
  .meta .sub { color: var(--orange); font-weight: 600; }
  .body-quote {
    color: var(--muted);
    font-size: 14px;
    border-left: 4px solid var(--border);
    padding-left: 10px;
    margin: 0 0 10px;
    white-space: pre-wrap;
  }
  .draft {
    background: var(--draft-bg);
    border: 1px solid var(--draft-border);
    border-radius: 8px;
    padding: 12px;
    font-size: 14px;
    white-space: pre-wrap;
    margin-bottom: 10px;
  }
  .draft .label { font-weight: 700; color: var(--orange); font-size: 12px; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px; }
  .warn { background: var(--warn-bg); color: var(--warn-text); border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-bottom: 10px; }
  .flags { background: var(--flag-bg); border: 1px solid var(--flag-border); border-radius: 8px; padding: 10px 12px; font-size: 14px; white-space: pre-wrap; margin-bottom: 10px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .actions a, .actions button {
    flex: 1 1 auto;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    border-radius: 999px;
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--chip-bg);
    color: var(--text);
  }
  .actions .open { background: var(--blue); border-color: var(--blue); color: #fff; }
  .actions .good { background: #2E9E44; border-color: #2E9E44; color: #fff; }
  .actions .bad { color: var(--muted); }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; background: var(--chip-bg); color: var(--muted); vertical-align: middle; }
  .empty { text-align: center; color: var(--muted); padding: 48px 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border); }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 6px 10px; }
  @media (min-width: 640px) {
    .actions a, .actions button { flex: 0 0 auto; }
  }
</style>
</head>
<body>
<header>
  <h1><span class="dot">●</span> Reddit Marketer</h1>
  <button id="themeToggle" aria-label="Toggle light/dark theme">🌙</button>
</header>
<nav>
  <button data-tab="matches" class="active">Matches</button>
  <button data-tab="suggestions">Post ideas</button>
  <button data-tab="runs">Runs</button>
</nav>
<main id="main"></main>
<script>
(function () {
  // ── Theme: Reddit light/dark with toggle, persisted, defaults to OS ──
  var root = document.documentElement;
  var toggle = document.getElementById('themeToggle');
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    toggle.textContent = t === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('rm-theme', t);
  }
  applyTheme(
    localStorage.getItem('rm-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
  toggle.addEventListener('click', function () {
    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // ── Auth token passthrough ──
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || localStorage.getItem('rm-token') || '';
  if (params.get('token')) localStorage.setItem('rm-token', token);
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) opts.headers['x-admin-token'] = token;
    return fetch(path, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  var main = document.getElementById('main');
  var tab = 'matches';
  var matchFilter = '';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll('nav button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === t);
    });
    render();
  }
  document.querySelectorAll('nav button').forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.dataset.tab); });
  });

  function render() {
    main.innerHTML = '<div class="empty">Loading…</div>';
    if (tab === 'matches') renderMatches();
    else if (tab === 'suggestions') renderSuggestions();
    else renderRuns();
  }

  function renderMatches() {
    var q = matchFilter ? '?status=' + matchFilter : '';
    api('/api/matches' + q).then(function (rows) {
      var filters =
        '<div class="filters">' +
        [['', 'Actionable'], ['new', 'New'], ['emailed', 'Emailed'], ['responded', 'Responded'], ['ignored', 'Ignored'], ['irrelevant', 'Filtered']]
          .map(function (f) {
            return '<button data-f="' + f[0] + '" class="' + (matchFilter === f[0] ? 'active' : '') + '">' + f[1] + '</button>';
          })
          .join('') +
        '</div>';

      if (!rows.length) {
        main.innerHTML = filters + '<div class="empty">No matches here. 🎉</div>';
      } else {
        main.innerHTML =
          filters +
          rows
            .map(function (m) {
              return (
                '<div class="card">' +
                '<h3>' + esc(m.post_title) + ' <span class="badge">' + esc(m.status) + '</span></h3>' +
                '<div class="meta"><span class="sub">r/' + esc(m.subreddit_name) + '</span> · u/' + esc(m.author) +
                ' · ' + esc(m.business_name) + ' · keyword: “' + esc(m.matched_keyword) + '”</div>' +
                (m.post_body ? '<p class="body-quote">' + esc(m.post_body.slice(0, 500)) + (m.post_body.length > 500 ? '…' : '') + '</p>' : '') +
                (m.ai_draft_response
                  ? '<div class="draft"><div class="label">Proposed reply</div>' + esc(m.ai_draft_response) + '</div>'
                  : '') +
                '<div class="actions">' +
                '<a class="open" href="' + esc(m.post_url) + '" target="_blank" rel="noopener">Open on Reddit</a>' +
                '<button class="good" data-act="responded" data-id="' + m.id + '">✓ Responded</button>' +
                '<button class="bad" data-act="ignored" data-id="' + m.id + '">Ignore</button>' +
                '</div></div>'
              );
            })
            .join('');
      }

      main.querySelectorAll('.filters button').forEach(function (b) {
        b.addEventListener('click', function () {
          matchFilter = b.dataset.f;
          render();
        });
      });
      main.querySelectorAll('button[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          api('/api/matches/' + b.dataset.id + '/status', {
            method: 'POST',
            body: JSON.stringify({ status: b.dataset.act }),
          }).then(render);
        });
      });
    }).catch(showError);
  }

  function renderSuggestions() {
    api('/api/suggestions').then(function (rows) {
      if (!rows.length) {
        main.innerHTML = '<div class="empty">No post suggestions yet.</div>';
        return;
      }
      main.innerHTML = rows
        .map(function (s) {
          return (
            '<div class="card suggestion">' +
            '<h3>r/' + esc(s.subreddit_name) + ' — ' + esc(s.business_name) + ' <span class="badge">' + esc(s.status) + '</span></h3>' +
            '<div class="meta">' + esc(s.chosen_reason) + '</div>' +
            '<div class="draft"><div class="label">Title</div>' + esc(s.post_title) + '</div>' +
            '<div class="draft"><div class="label">Body</div>' + esc(s.post_body) + '</div>' +
            (s.key_rules_summary ? '<div class="meta"><b>Key rules:</b> ' + esc(s.key_rules_summary) + '</div>' : '') +
            (s.unverified_flags ? '<div class="flags"><b>⚠️ Check manually:</b>\\n' + esc(s.unverified_flags) + '</div>' : '') +
            '<div class="warn"><b>Reminder:</b> a rules-compliant draft can still be removed by Reddit\\u2019s spam filter or mod discretion — nothing is guaranteed. Review and submit manually.</div>' +
            (s.status === 'new' || s.status === 'emailed'
              ? '<div class="actions">' +
                '<button class="good" data-act="posted" data-id="' + s.id + '">✓ I posted it</button>' +
                '<button class="bad" data-act="skipped" data-id="' + s.id + '">Skip</button>' +
                '</div>'
              : '') +
            '</div>'
          );
        })
        .join('');
      main.querySelectorAll('button[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          api('/api/suggestions/' + b.dataset.id + '/status', {
            method: 'POST',
            body: JSON.stringify({ status: b.dataset.act }),
          }).then(render);
        });
      });
    }).catch(showError);
  }

  function renderRuns() {
    api('/api/runs').then(function (rows) {
      if (!rows.length) {
        main.innerHTML = '<div class="empty">No runs recorded yet.</div>';
        return;
      }
      main.innerHTML =
        '<div class="table-wrap"><table><thead><tr>' +
        '<th>#</th><th>Started</th><th>Checked</th><th>New</th><th>Drafts</th><th>Errors</th>' +
        '</tr></thead><tbody>' +
        rows
          .map(function (r) {
            return (
              '<tr><td>' + r.id + '</td>' +
              '<td>' + esc(new Date(r.started_at).toLocaleString()) + '</td>' +
              '<td>' + r.posts_checked + '</td>' +
              '<td>' + r.new_matches + '</td>' +
              '<td>' + r.drafts_created + '</td>' +
              '<td>' + (r.errors ? esc(r.errors.slice(0, 200)) : '—') + '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';
    }).catch(showError);
  }

  function showError(err) {
    main.innerHTML = '<div class="empty">Error: ' + esc(err.message) + '</div>';
  }

  render();
})();
</script>
</body>
</html>`;
