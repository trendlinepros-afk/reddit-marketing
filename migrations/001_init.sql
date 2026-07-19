-- Wicked RC initial schema

CREATE TABLE IF NOT EXISTS businesses (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  domain        TEXT NOT NULL DEFAULT '',
  voice_profile TEXT NOT NULL DEFAULT '',
  ai_provider   TEXT NOT NULL DEFAULT 'anthropic' CHECK (ai_provider IN ('anthropic', 'gemini')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subreddits (
  id                SERIAL PRIMARY KEY,
  business_id       INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subreddit_name    TEXT NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  last_suggested_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, subreddit_name)
);

CREATE TABLE IF NOT EXISTS keywords (
  id          SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phrase      TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, phrase)
);

CREATE TABLE IF NOT EXISTS matches (
  id                SERIAL PRIMARY KEY,
  business_id       INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subreddit_name    TEXT NOT NULL,
  reddit_post_id    TEXT NOT NULL UNIQUE,
  post_title        TEXT NOT NULL,
  post_body         TEXT NOT NULL DEFAULT '',
  post_url          TEXT NOT NULL,
  author            TEXT NOT NULL DEFAULT '',
  created_utc       TIMESTAMPTZ NOT NULL,
  matched_keyword   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'emailed', 'responded', 'ignored', 'irrelevant')),
  ai_draft_response TEXT,
  found_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_business ON matches(business_id);

-- Daily "new post" suggestions with the rules they were checked against
CREATE TABLE IF NOT EXISTS post_suggestions (
  id               SERIAL PRIMARY KEY,
  business_id      INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subreddit_name   TEXT NOT NULL,
  rules_json       JSONB NOT NULL DEFAULT '[]',
  submit_text      TEXT NOT NULL DEFAULT '',
  chosen_reason    TEXT NOT NULL DEFAULT '',
  key_rules_summary TEXT NOT NULL DEFAULT '',
  post_title       TEXT NOT NULL,
  post_body        TEXT NOT NULL,
  unverified_flags TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'emailed', 'posted', 'skipped')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scan run stats for debugging
CREATE TABLE IF NOT EXISTS scan_runs (
  id             SERIAL PRIMARY KEY,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  posts_checked  INTEGER NOT NULL DEFAULT 0,
  new_matches    INTEGER NOT NULL DEFAULT 0,
  drafts_created INTEGER NOT NULL DEFAULT 0,
  errors         TEXT NOT NULL DEFAULT ''
);
