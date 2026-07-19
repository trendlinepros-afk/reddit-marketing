# Reddit Marketer

Internal research/lead-gen tool. Every day it:

1. **Scans Reddit** for posts matching each business's keywords in its target subreddits (last 24–48h, deduplicated).
2. **Filters + drafts** — a cheap AI relevance check discards keyword false-positives, then the business's configured AI provider (Anthropic or Gemini) drafts a reply in that business's voice.
3. **Suggests one original post** — picks a subreddit (round-robin with a cooldown), fetches its live rules via the Reddit API, drafts a rules-checked post, and flags anything it couldn't verify programmatically.
4. **Emails a digest** at 10am ET via Mailgun, grouped by business.

It also serves a **mobile-friendly admin dashboard** (Reddit-style theme, light/dark toggle) for reviewing matches and marking them responded/ignored.

**This tool never posts to Reddit.** All replies and posts are reviewed and submitted manually by you.

## Stack

- Node.js 20+ / TypeScript
- PostgreSQL (Railway)
- Reddit API (OAuth script app) — rate limits are read dynamically from Reddit's `X-Ratelimit-*` response headers, not hardcoded
- Anthropic Claude API + Google Gemini API behind a common provider interface, swappable per business
- Mailgun for the digest (responsive HTML email with dark-mode support)
- node-cron scheduler + zero-dependency dashboard server (always-on mode), or Railway cron (one-shot mode)

## Local setup

```bash
npm install
cp .env.example .env   # fill in credentials
npm run build
npm run migrate        # apply DB migrations

# Seed your first business
npm run admin -- business:add "Acme Widgets" "acmewidgets.com" "Friendly, practical DIY-er tone. Never mention the company unless directly asked for product recommendations." anthropic
npm run admin -- subreddit:add 1 widgets
npm run admin -- keyword:add 1 "widget recommendations"

# Run the full pipeline once
npm run job:daily

# Or start the always-on scheduler + dashboard (http://localhost:3000)
npm start
```

> Local note: `.env` is not auto-loaded by the app (Railway injects env vars directly). Locally, run with `node --env-file=.env dist/index.js` or export the vars in your shell.

## Admin dashboard

`npm start` serves the dashboard on `PORT` (default 3000):

- **Matches** — review each opportunity with its proposed reply, open the post on Reddit, and mark it ✓ Responded or Ignore (the manual feedback loop). Filter by status.
- **Post ideas** — the daily rules-checked post suggestions with their manual-check flags; mark posted/skipped.
- **Runs** — scan run stats for debugging.

Theme follows your OS light/dark preference by default; the toggle in the header overrides it (persisted). The layout is mobile-first — fluid single column, large tap targets, sticky header.

**Auth:** set `ADMIN_TOKEN` and open the dashboard as `/?token=<value>` once; the page remembers it. Without `ADMIN_TOKEN` the dashboard is open — don't expose it publicly unprotected.

## Admin CLI

Everything the dashboard does is also available from the CLI:

```
npm run admin -- business:add "<name>" "<domain>" "<voice profile>" [anthropic|gemini]
npm run admin -- business:list
npm run admin -- subreddit:add <business_id> <subreddit>
npm run admin -- keyword:add <business_id> "<phrase>"
npm run admin -- match:list [new|emailed|responded|ignored|irrelevant]
npm run admin -- match:status <id> <responded|ignored>     # feedback loop
npm run admin -- suggestion:list
npm run admin -- suggestion:status <id> <posted|skipped>
npm run admin -- runs:list                                  # scan run stats
```

## Deploying on Railway (GitHub-connected)

1. Push this repo to GitHub; in Railway, **New Project → Deploy from GitHub repo**.
2. Add a **PostgreSQL** service to the project. On the app service, set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}` plus the rest of the variables in `.env.example`.
3. Pick **one** of the two scheduling modes:

### Option A — always-on service (default, recommended)

`railway.json` is set up for this: the start command is `npm run migrate && npm start`. The process stays up, serves the dashboard, and node-cron fires the pipeline at `0 10 * * *` in `America/New_York` — EST/EDT handled automatically. Generate a domain for the service in Railway settings to reach the dashboard, and set `ADMIN_TOKEN`.

### Option B — Railway cron (no always-on process, no dashboard)

Change the start command to `npm run migrate && npm run job:daily` (runs once and exits) and set a **Cron Schedule** on the service. Railway cron runs in **UTC**, so 10am ET is `0 14 * * *` during EDT and `0 15 * * *` during EST — pick one and accept the 1-hour seasonal shift.

## Environment variables

See `.env.example` for the full list. Required: `DATABASE_URL`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY` (whichever providers your businesses use), `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `DIGEST_TO_EMAIL`. Recommended: `ADMIN_TOKEN`.

## Data model

- `businesses` — name, domain, voice_profile, ai_provider (anthropic|gemini), active
- `subreddits` — per business, with `last_suggested_at` for post-suggestion round-robin
- `keywords` — per business
- `matches` — deduplicated by `reddit_post_id`; status flow: `new → emailed → responded|ignored` (plus `irrelevant` for AI-filtered false positives)
- `post_suggestions` — daily post drafts with the fetched rules snapshot (`rules_json`), key-rules summary, and manual-check flags
- `scan_runs` — per-run stats (posts checked, matches, drafts, errors) for debugging

## Important caveats (also repeated in every digest)

- A rules-compliant draft can still be removed by Reddit's site-wide spam filter or by mod discretion. The compliance pass only checks the subreddit's *stated* rules (`/about/rules` + `submit_text`).
- Karma/account-age gates, flair that must be chosen at submit time, and rules that live only in stickied mod posts cannot be verified programmatically — the digest flags these for manual review.
