import { Pool } from 'pg';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { config } from '../config';
import { Match, PostSuggestion } from '../types';

interface DigestMatch extends Match {
  business_name: string;
}

interface DigestSuggestion extends PostSuggestion {
  business_name: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function nl2br(s: string): string {
  return esc(s).replace(/\n/g, '<br>');
}

// Reddit palette
const C = {
  orange: '#FF4500',
  blue: '#0079D3',
  lightBg: '#DAE0E6',
  card: '#FFFFFF',
  text: '#1A1A1B',
  muted: '#7C7C7C',
  border: '#EDEFF1',
  upvoteBg: '#FFF3EE',
  warnBg: '#FFF8E5',
  warnText: '#8A6D00',
};

function renderMatch(m: DigestMatch): string {
  return `
    <div class="card" style="background:${C.card};border:1px solid ${C.border};border-radius:8px;padding:16px;margin-bottom:14px;">
      <div style="font-weight:600;font-size:16px;line-height:1.35;margin-bottom:6px;color:${C.text};">${esc(m.post_title)}</div>
      <div style="color:${C.muted};font-size:13px;margin-bottom:10px;line-height:1.5;">
        <span style="color:${C.orange};font-weight:600;">r/${esc(m.subreddit_name)}</span>
        &nbsp;·&nbsp;u/${esc(m.author)}&nbsp;·&nbsp;keyword: &quot;${esc(m.matched_keyword)}&quot;<br>
        <a href="${esc(m.post_url)}" style="display:inline-block;margin-top:6px;padding:8px 14px;background:${C.blue};color:#ffffff;border-radius:999px;text-decoration:none;font-weight:600;font-size:13px;">Open on Reddit →</a>
      </div>
      ${
        m.post_body
          ? `<div style="color:#4a4a4b;font-size:14px;line-height:1.5;margin-bottom:12px;border-left:4px solid ${C.border};padding-left:12px;">${nl2br(
              m.post_body.slice(0, 600)
            )}${m.post_body.length > 600 ? '…' : ''}</div>`
          : ''
      }
      <div style="background:${C.upvoteBg};border:1px solid #FFD9C7;border-radius:8px;padding:14px;font-size:14px;line-height:1.55;color:${C.text};">
        <div style="font-weight:700;color:${C.orange};margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:0.4px;">Proposed reply · match #${m.id}</div>
        ${nl2br(m.ai_draft_response ?? '(no draft)')}
      </div>
    </div>`;
}

function renderSuggestion(s: DigestSuggestion): string {
  return `
    <div class="card" style="background:${C.card};border:2px solid ${C.orange};border-radius:8px;padding:16px;margin-bottom:14px;">
      <div style="font-weight:700;font-size:16px;line-height:1.35;margin-bottom:6px;color:${C.text};">
        Suggested post for <span style="color:${C.orange};">r/${esc(s.subreddit_name)}</span> — ${esc(s.business_name)}
      </div>
      <div style="color:${C.muted};font-size:13px;line-height:1.5;margin-bottom:12px;">${esc(s.chosen_reason)}</div>

      <div style="font-size:14px;line-height:1.55;margin-bottom:12px;color:${C.text};">
        <b>Key rules that shaped this draft:</b><br>${nl2br(s.key_rules_summary || '(none noted)')}
      </div>

      <div style="background:#F6F7F8;border:1px solid ${C.border};border-radius:8px;padding:14px;margin-bottom:12px;">
        <div style="font-weight:700;margin-bottom:8px;font-size:15px;line-height:1.4;color:${C.text};">${esc(s.post_title)}</div>
        <div style="font-size:14px;line-height:1.55;color:${C.text};">${nl2br(s.post_body)}</div>
      </div>

      ${
        s.unverified_flags
          ? `<div style="background:#FDF1F1;border:1px solid #F5C6C6;border-radius:8px;padding:12px;font-size:14px;line-height:1.5;margin-bottom:12px;color:${C.text};">
               <b>⚠️ Check manually before posting:</b><br>${nl2br(s.unverified_flags)}
             </div>`
          : ''
      }

      <div style="background:${C.warnBg};border-radius:8px;padding:12px;color:${C.warnText};font-size:13px;line-height:1.5;">
        <b>Reminder:</b> even a rules-compliant draft can still be removed by Reddit's site-wide spam filter
        or by moderator discretion. This draft is checked against the subreddit's <i>stated</i> rules only —
        nothing is guaranteed to survive. Review and submit manually.
      </div>
    </div>`;
}

/**
 * Build and send the daily digest, then mark included items as 'emailed'.
 * Layout notes: single fluid column (max 680px), inline styles for email-client
 * compatibility, ≥14px body text and large tap targets for mobile, plus a
 * prefers-color-scheme media query for clients that support dark mode.
 */
export async function sendDailyDigest(pool: Pool): Promise<{ matches: number; suggestions: number }> {
  const { rows: matches } = await pool.query<DigestMatch>(
    `SELECT m.*, b.name AS business_name
     FROM matches m
     JOIN businesses b ON b.id = m.business_id
     WHERE m.status = 'new' AND m.ai_draft_response IS NOT NULL
     ORDER BY b.name, m.found_at DESC`
  );

  const { rows: suggestions } = await pool.query<DigestSuggestion>(
    `SELECT s.*, b.name AS business_name
     FROM post_suggestions s
     JOIN businesses b ON b.id = s.business_id
     WHERE s.status = 'new'
     ORDER BY s.created_at DESC`
  );

  if (matches.length === 0 && suggestions.length === 0) {
    console.log('[digest] nothing to send today');
    return { matches: 0, suggestions: 0 };
  }

  const byBusiness = new Map<string, DigestMatch[]>();
  for (const m of matches) {
    const list = byBusiness.get(m.business_name) ?? [];
    list.push(m);
    byBusiness.set(m.business_name, list);
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });

  let sections = '';
  for (const [businessName, businessMatches] of byBusiness) {
    sections += `<h2 style="font-size:17px;color:${C.text};border-bottom:2px solid ${C.border};padding-bottom:8px;margin:24px 0 14px;">${esc(
      businessName
    )} <span style="color:${C.muted};font-weight:400;">(${businessMatches.length})</span></h2>`;
    sections += businessMatches.map(renderMatch).join('');
  }

  if (suggestions.length > 0) {
    sections += `<h2 style="font-size:17px;color:${C.text};border-bottom:2px solid ${C.orange};padding-bottom:8px;margin:24px 0 14px;">Today's post suggestion${
      suggestions.length > 1 ? 's' : ''
    }</h2>`;
    sections += suggestions.map(renderSuggestion).join('');
  }

  const html = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<style>
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  .wrap { padding: 12px; }
  .card { word-break: break-word; }
  @media (prefers-color-scheme: dark) {
    body, .bg { background: #030303 !important; }
    .card, .inner { background: #1A1A1B !important; border-color: #343536 !important; }
    .card, .card div, h1, h2 { color: #D7DADC !important; }
  }
  @media only screen and (max-width: 480px) {
    .wrap { padding: 8px; }
  }
</style>
</head>
<body class="bg" style="background:${C.lightBg};">
  <div class="wrap" style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;color:${C.text};">
    <div class="inner" style="background:${C.card};border-radius:8px;padding:16px 18px;margin-bottom:14px;border:1px solid ${C.border};">
      <h1 style="font-size:20px;margin:0 0 6px;color:${C.text};">
        <span style="color:${C.orange};">●</span> Reddit Marketer — ${esc(today)}
      </h1>
      <p style="color:${C.muted};font-size:14px;line-height:1.5;margin:0;">
        ${matches.length} reply ${matches.length === 1 ? 'opportunity' : 'opportunities'}
        · ${suggestions.length} post ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}.
        Nothing is posted automatically — everything below is for your review.
      </p>
    </div>
    ${sections}
    <p style="color:${C.muted};font-size:12px;line-height:1.6;margin-top:20px;padding:0 4px;">
      Mark a match handled from the dashboard, or:
      <code>npm run admin -- match:status &lt;id&gt; responded|ignored</code>
    </p>
  </div>
</body>
</html>`;

  const mailgun = new Mailgun(formData);
  const mg = mailgun.client({ username: 'api', key: config.mailgunApiKey });

  await mg.messages.create(config.mailgunDomain, {
    from: config.digestFromEmail,
    to: [config.digestToEmail],
    subject: `Reddit Marketer — ${matches.length} opportunities, ${suggestions.length} post idea${
      suggestions.length === 1 ? '' : 's'
    } (${today})`,
    html,
  });

  if (matches.length > 0) {
    await pool.query(`UPDATE matches SET status = 'emailed' WHERE id = ANY($1::int[])`, [
      matches.map((m) => m.id),
    ]);
  }
  if (suggestions.length > 0) {
    await pool.query(`UPDATE post_suggestions SET status = 'emailed' WHERE id = ANY($1::int[])`, [
      suggestions.map((s) => s.id),
    ]);
  }

  console.log(`[digest] sent: ${matches.length} matches, ${suggestions.length} suggestions`);
  return { matches: matches.length, suggestions: suggestions.length };
}
