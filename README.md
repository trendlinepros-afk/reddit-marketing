# Wicked RC — Reddit Marketing Pipeline

Internal research/lead-gen tool. Every day it:

1. **Scans Reddit** for posts matching each business's keywords in its target subreddits (last 24–48h, deduplicated).
2. **Filters + drafts** — a cheap AI relevance check discards keyword false-positives, then the business's configured AI provider (Anthropic or Gemini) drafts a reply in that business's voice.
3. **Suggests one original post** — picks a subreddit (round-robin with a cooldown), fetches its live rules via the Reddit API, drafts a rules-checked post, and flags anything it couldn't verify programmatically.
4. **Emails a digest** at 10am ET via Mailgun, grouped by business.

**This tool never posts to Reddit.** All replies and posts are reviewed and submitted manually by you.

## Stack

- Node.js 20+ / TypeScript
- PostgreSQL (Railway)
- Reddit API (OAuth script app) — rate limits are read dynamically from Reddit's `X-Ratelimit-*` response headers, not hardcoded
- Anthropic Claude API + Google Gemini API behind a common provider interface, swappable per business
- Mailgun for the digest
- node-cron (always-on mode) or Railway cron (one-shot mode)

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
```

> Local note: `.env` is not auto-loaded by the app (Railway injects env vars directly). Locally, run with `node --env-file=.env dist/jobs/daily.js` or export the vars in your shell.

## Admin CLI

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

### Option A — Railway cron (recommended, no always-on process)

`railway.json` is already set up for this: the start command is `npm run migrate && npm run job:daily`, which runs the whole pipeline once and exits.

In the service settings, set the **Cron Schedule**. Railway cron runs in **UTC**, so 10am ET is:

- `0 14 * * *` during EDT (roughly Mar–Nov)
- `0 15 * * *` during EST (Nov–Mar)

Pick `0 14 * * *` and accept the 1-hour winter shift, or use Option B for automatic DST handling.

### Option B — always-on scheduler (exact 10am ET year-round)

Change the start command to `npm run migrate && npm start` and **remove the cron schedule**. The process stays up and node-cron fires at `0 10 * * *` in `America/New_York`, handling EST/EDT automatically.

## Environment variables

See `.env.example` for the full list. Required: `DATABASE_URL`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY` (whichever providers your businesses use), `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `DIGEST_TO_EMAIL`.

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
