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

function renderMatch(m: DigestMatch): string {
  return `
    <div style="border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="font-weight:bold;font-size:15px;margin-bottom:4px;">${esc(m.post_title)}</div>
      <div style="color:#666;font-size:12px;margin-bottom:8px;">
        r/${esc(m.subreddit_name)} · u/${esc(m.author)} · keyword: "${esc(m.matched_keyword)}" ·
        <a href="${esc(m.post_url)}">open on Reddit</a>
      </div>
      ${m.post_body ? `<div style="color:#444;font-size:13px;margin-bottom:10px;border-left:3px solid #eee;padding-left:10px;">${nl2br(m.post_body.slice(0, 600))}${m.post_body.length > 600 ? '…' : ''}</div>` : ''}
      <div style="background:#f4f8f4;border-radius:6px;padding:12px;font-size:13px;">
        <div style="font-weight:bold;color:#2a6f2a;margin-bottom:6px;">Proposed reply (match #${m.id})</div>
        ${nl2br(m.ai_draft_response ?? '(no draft)')}
      </div>
    </div>`;
}

function renderSuggestion(s: DigestSuggestion): string {
  return `
    <div style="border:2px solid #d8c46a;border-radius:8px;padding:16px;margin-bottom:16px;background:#fffdf3;">
      <div style="font-weight:bold;font-size:15px;margin-bottom:4px;">
        Suggested post for r/${esc(s.subreddit_name)} — ${esc(s.business_name)}
      </div>
      <div style="color:#666;font-size:12px;margin-bottom:10px;">${esc(s.chosen_reason)}</div>

      <div style="font-size:13px;margin-bottom:10px;">
        <b>Key rules that shaped this draft:</b><br>${nl2br(s.key_rules_summary || '(none noted)')}
      </div>

      <div style="background:#fff;border:1px solid #eee;border-radius:6px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:bold;margin-bottom:6px;">Title: ${esc(s.post_title)}</div>
        <div style="font-size:13px;">${nl2br(s.post_body)}</div>
      </div>

      ${
        s.unverified_flags
          ? `<div style="background:#fdf1f1;border-radius:6px;padding:10px;font-size:13px;margin-bottom:10px;">
               <b>⚠️ Check manually before posting:</b><br>${nl2br(s.unverified_flags)}
             </div>`
          : ''
      }

      <div style="color:#8a6d00;font-size:12px;">
        <b>Reminder:</b> even a rules-compliant draft can still be removed by Reddit's site-wide spam filter
        or by moderator discretion. This draft is checked against the subreddit's <i>stated</i> rules only —
        nothing is guaranteed to survive. Review and submit manually.
      </div>
    </div>`;
}

/**
 * Build and send the daily digest, then mark included items as 'emailed'.
 * Returns the number of matches included.
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

  // Group matches by business
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

  let html = `
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;color:#222;">
      <h1 style="font-size:20px;">Wicked RC — Reddit digest for ${esc(today)}</h1>
      <p style="color:#666;font-size:13px;">
        ${matches.length} reply ${matches.length === 1 ? 'opportunity' : 'opportunities'}
        · ${suggestions.length} post ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}.
        Nothing is posted automatically — everything below is for your review.
      </p>`;

  for (const [businessName, businessMatches] of byBusiness) {
    html += `<h2 style="font-size:16px;border-bottom:2px solid #eee;padding-bottom:6px;">${esc(businessName)} (${businessMatches.length})</h2>`;
    html += businessMatches.map(renderMatch).join('');
  }

  if (suggestions.length > 0) {
    html += `<h2 style="font-size:16px;border-bottom:2px solid #d8c46a;padding-bottom:6px;">Today's post suggestion${suggestions.length > 1 ? 's' : ''}</h2>`;
    html += suggestions.map(renderSuggestion).join('');
  }

  html += `
      <p style="color:#999;font-size:12px;margin-top:24px;">
        To mark a match handled: <code>npm run admin -- match:status &lt;id&gt; responded|ignored</code>
      </p>
    </div>`;

  const mailgun = new Mailgun(formData);
  const mg = mailgun.client({ username: 'api', key: config.mailgunApiKey });

  await mg.messages.create(config.mailgunDomain, {
    from: config.digestFromEmail,
    to: [config.digestToEmail],
    subject: `Wicked RC digest — ${matches.length} opportunities, ${suggestions.length} post idea${suggestions.length === 1 ? '' : 's'} (${today})`,
    html,
  });

  // Mark everything included as emailed only after a successful send
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
