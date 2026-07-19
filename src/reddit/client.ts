import { config } from '../config';
import { RedditPost, SubredditAbout, SubredditRule } from '../types';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';

interface TokenState {
  accessToken: string;
  expiresAt: number; // epoch ms
}

/**
 * Minimal Reddit API client for a "script" OAuth app.
 *
 * Rate limiting: Reddit does not want clients to hardcode an assumed limit —
 * the authoritative values come back on every response in the
 * X-Ratelimit-Used / X-Ratelimit-Remaining / X-Ratelimit-Reset headers.
 * We read those headers dynamically and pause when the remaining budget
 * runs low, so the client adapts to whatever limit Reddit currently enforces.
 */
export class RedditClient {
  private token: TokenState | null = null;

  private rateRemaining = Infinity;
  private rateResetSeconds = 0;

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) {
      return this.token.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'password',
      username: config.redditUsername,
      password: config.redditPassword,
    });

    const auth = Buffer.from(`${config.redditClientId}:${config.redditClientSecret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': config.redditUserAgent,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`Reddit OAuth failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.token.accessToken;
  }

  private updateRateLimits(res: Response): void {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining !== null) this.rateRemaining = parseFloat(remaining);
    if (reset !== null) this.rateResetSeconds = parseFloat(reset);
  }

  private async throttle(): Promise<void> {
    // If we're nearly out of budget, wait for the window to reset.
    if (this.rateRemaining < 2 && this.rateResetSeconds > 0) {
      const waitMs = (this.rateResetSeconds + 1) * 1000;
      console.log(`[reddit] rate limit nearly exhausted; sleeping ${Math.round(waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, waitMs));
      this.rateRemaining = Infinity;
    }
  }

  private async get<T>(pathAndQuery: string, retries = 3): Promise<T> {
    await this.throttle();
    const token = await this.ensureToken();

    const res = await fetch(`${API_BASE}${pathAndQuery}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': config.redditUserAgent,
      },
    });

    this.updateRateLimits(res);

    if (res.status === 429 && retries > 0) {
      const retryAfter = parseFloat(res.headers.get('retry-after') ?? '10');
      console.log(`[reddit] 429 received; backing off ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      return this.get<T>(pathAndQuery, retries - 1);
    }

    if ((res.status >= 500 || res.status === 408) && retries > 0) {
      await new Promise((r) => setTimeout(r, 2000 * (4 - retries)));
      return this.get<T>(pathAndQuery, retries - 1);
    }

    if (!res.ok) {
      throw new Error(`Reddit API error ${res.status} on ${pathAndQuery}: ${await res.text()}`);
    }

    return (await res.json()) as T;
  }

  /**
   * Search a subreddit for a keyword, sorted by new, restricted to recent posts.
   * Time filtering: Reddit's `t` param only supports hour/day/week/etc., so we
   * request t=week sorted by new and post-filter to the scan window client-side.
   */
  async searchSubreddit(subreddit: string, keyword: string, windowHours: number): Promise<RedditPost[]> {
    const query = new URLSearchParams({
      q: keyword,
      restrict_sr: 'true',
      sort: 'new',
      t: 'week',
      limit: '50',
      type: 'link',
    });

    const data = await this.get<{
      data: { children: Array<{ data: Record<string, unknown> }> };
    }>(`/r/${encodeURIComponent(subreddit)}/search?${query.toString()}`);

    const cutoff = Date.now() / 1000 - windowHours * 3600;

    return data.data.children
      .map((c) => c.data)
      .filter((p) => typeof p.created_utc === 'number' && (p.created_utc as number) >= cutoff)
      .map((p) => ({
        id: String(p.id),
        title: String(p.title ?? ''),
        selftext: String(p.selftext ?? ''),
        permalink: `https://www.reddit.com${String(p.permalink ?? '')}`,
        author: String(p.author ?? ''),
        subreddit: String(p.subreddit ?? subreddit),
        created_utc: Number(p.created_utc),
      }));
  }

  /** Fetch a subreddit's posting rules. */
  async getSubredditRules(subreddit: string): Promise<SubredditRule[]> {
    const data = await this.get<{
      rules: Array<{
        short_name?: string;
        description?: string;
        kind?: string;
        violation_reason?: string;
      }>;
    }>(`/r/${encodeURIComponent(subreddit)}/about/rules`);

    return (data.rules ?? []).map((r) => ({
      short_name: r.short_name ?? '',
      description: r.description ?? '',
      kind: r.kind ?? 'all',
      violation_reason: r.violation_reason ?? '',
    }));
  }

  /** Fetch subreddit metadata including submit_text and sidebar description. */
  async getSubredditAbout(subreddit: string): Promise<SubredditAbout> {
    const data = await this.get<{
      data: {
        title?: string;
        public_description?: string;
        submit_text?: string;
        subreddit_type?: string;
        description?: string;
      };
    }>(`/r/${encodeURIComponent(subreddit)}/about`);

    return {
      title: data.data.title ?? '',
      public_description: data.data.public_description ?? '',
      // submit_text is the guidance shown on the submit page; fall back to sidebar.
      submit_text: data.data.submit_text || data.data.description || '',
      subreddit_type: data.data.subreddit_type ?? 'public',
    };
  }
}
