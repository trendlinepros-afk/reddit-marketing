function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// All configuration comes from environment variables (Railway-style).
// Getters are lazy so that commands that don't need a given service
// (e.g. `npm run migrate`) don't fail on unrelated missing vars.
export const config = {
  get databaseUrl(): string {
    return required('DATABASE_URL');
  },

  // Reddit OAuth "script" app credentials
  get redditClientId(): string {
    return required('REDDIT_CLIENT_ID');
  },
  get redditClientSecret(): string {
    return required('REDDIT_CLIENT_SECRET');
  },
  get redditUsername(): string {
    return required('REDDIT_USERNAME');
  },
  get redditPassword(): string {
    return required('REDDIT_PASSWORD');
  },
  get redditUserAgent(): string {
    // Reddit requires a descriptive, unique user agent:
    // <platform>:<app ID>:<version> (by /u/<username>)
    return optional(
      'REDDIT_USER_AGENT',
      `nodejs:reddit-marketer:1.0.0 (by /u/${process.env.REDDIT_USERNAME ?? 'unknown'})`
    );
  },

  // AI providers
  get anthropicApiKey(): string {
    return required('ANTHROPIC_API_KEY');
  },
  get anthropicModel(): string {
    return optional('ANTHROPIC_MODEL', 'claude-opus-4-8');
  },
  get anthropicRelevanceModel(): string {
    // Cheap relevance pre-filter model
    return optional('ANTHROPIC_RELEVANCE_MODEL', 'claude-haiku-4-5');
  },
  get geminiApiKey(): string {
    return required('GEMINI_API_KEY');
  },
  get geminiModel(): string {
    return optional('GEMINI_MODEL', 'gemini-2.5-pro');
  },
  get geminiRelevanceModel(): string {
    return optional('GEMINI_RELEVANCE_MODEL', 'gemini-2.5-flash');
  },

  // Mailgun
  get mailgunApiKey(): string {
    return required('MAILGUN_API_KEY');
  },
  get mailgunDomain(): string {
    return required('MAILGUN_DOMAIN');
  },
  get digestToEmail(): string {
    return required('DIGEST_TO_EMAIL');
  },
  get digestFromEmail(): string {
    return optional('DIGEST_FROM_EMAIL', `Reddit Marketer <redditmarketer@${process.env.MAILGUN_DOMAIN}>`);
  },

  // Admin dashboard (always-on mode)
  get port(): number {
    return parseInt(optional('PORT', '3000'), 10);
  },
  get adminToken(): string {
    // Optional shared secret; when set, the dashboard requires ?token=<value>
    return optional('ADMIN_TOKEN', '');
  },

  // Scanner behavior
  get scanWindowHours(): number {
    return parseInt(optional('SCAN_WINDOW_HOURS', '48'), 10);
  },
  get suggestionCooldownDays(): number {
    return parseInt(optional('SUGGESTION_COOLDOWN_DAYS', '14'), 10);
  },
  get maxDraftsPerRun(): number {
    // Safety cap on AI spend per daily run
    return parseInt(optional('MAX_DRAFTS_PER_RUN', '25'), 10);
  },

  // Cron (only used in always-on mode, `npm start`)
  get cronSchedule(): string {
    return optional('CRON_SCHEDULE', '0 10 * * *');
  },
  get cronTimezone(): string {
    return optional('CRON_TZ', 'America/New_York');
  },
};
