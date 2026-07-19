import { Pool } from 'pg';
import { RedditClient } from '../reddit/client';
import { Business, Keyword, Subreddit } from '../types';
import { config } from '../config';

export interface ScanStats {
  postsChecked: number;
  newMatches: number;
  errors: string[];
}

/**
 * Scan Reddit for each active business × subreddit × keyword combination,
 * deduplicating against the matches table by reddit_post_id.
 */
export async function runScanner(pool: Pool, reddit: RedditClient): Promise<ScanStats> {
  const stats: ScanStats = { postsChecked: 0, newMatches: 0, errors: [] };

  const { rows: businesses } = await pool.query<Business>(
    `SELECT * FROM businesses WHERE active = TRUE ORDER BY id`
  );

  for (const business of businesses) {
    const { rows: subreddits } = await pool.query<Subreddit>(
      `SELECT * FROM subreddits WHERE business_id = $1 AND active = TRUE ORDER BY id`,
      [business.id]
    );
    const { rows: keywords } = await pool.query<Keyword>(
      `SELECT * FROM keywords WHERE business_id = $1 AND active = TRUE ORDER BY id`,
      [business.id]
    );

    for (const sub of subreddits) {
      for (const kw of keywords) {
        try {
          const posts = await reddit.searchSubreddit(sub.subreddit_name, kw.phrase, config.scanWindowHours);
          stats.postsChecked += posts.length;

          for (const post of posts) {
            // Skip deleted/removed authors and empty titles defensively
            if (!post.id || !post.title) continue;

            const result = await pool.query(
              `INSERT INTO matches
                 (business_id, subreddit_name, reddit_post_id, post_title, post_body,
                  post_url, author, created_utc, matched_keyword, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8), $9, 'new')
               ON CONFLICT (reddit_post_id) DO NOTHING`,
              [
                business.id,
                post.subreddit,
                post.id,
                post.title,
                post.selftext,
                post.permalink,
                post.author,
                post.created_utc,
                kw.phrase,
              ]
            );
            stats.newMatches += result.rowCount ?? 0;
          }
        } catch (err) {
          const msg = `scan ${business.name}/r/${sub.subreddit_name}/"${kw.phrase}": ${(err as Error).message}`;
          console.error(`[scanner] ${msg}`);
          stats.errors.push(msg);
        }
      }
    }
  }

  console.log(`[scanner] checked ${stats.postsChecked} posts, ${stats.newMatches} new matches`);
  return stats;
}
