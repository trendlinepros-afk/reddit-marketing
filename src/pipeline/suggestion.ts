import { Pool } from 'pg';
import { RedditClient } from '../reddit/client';
import { Business, Subreddit } from '../types';
import { getAiProvider } from '../ai/factory';
import { config } from '../config';

export interface SuggestionResult {
  created: boolean;
  subreddit?: string;
  business?: string;
  error?: string;
}

/**
 * Pick one subreddit (least-recently-suggested first, respecting the cooldown
 * window), fetch its current rules, and generate a rule-checked original post
 * draft for the digest. The system never submits the post — it's for manual
 * review and submission.
 */
export async function generateDailySuggestion(pool: Pool, reddit: RedditClient): Promise<SuggestionResult> {
  // Round-robin: pick the active subreddit whose last_suggested_at is oldest
  // (NULL = never suggested, wins first), excluding anything inside the cooldown.
  const { rows } = await pool.query<Subreddit & { business: Business }>(
    `SELECT s.*, row_to_json(b.*) AS business
     FROM subreddits s
     JOIN businesses b ON b.id = s.business_id
     WHERE s.active = TRUE
       AND b.active = TRUE
       AND (s.last_suggested_at IS NULL OR s.last_suggested_at < now() - ($1 || ' days')::interval)
     ORDER BY s.last_suggested_at ASC NULLS FIRST, s.id ASC
     LIMIT 1`,
    [config.suggestionCooldownDays]
  );

  if (rows.length === 0) {
    console.log('[suggestion] no eligible subreddit (all within cooldown window)');
    return { created: false, error: 'All subreddits are within the suggestion cooldown window.' };
  }

  const sub = rows[0];
  const business = sub.business;

  try {
    const [rules, about] = await Promise.all([
      reddit.getSubredditRules(sub.subreddit_name),
      reddit.getSubredditAbout(sub.subreddit_name),
    ]);

    const provider = getAiProvider(business.ai_provider);
    const result = await provider.draftCompliantPost({
      businessName: business.name,
      businessDomain: business.domain,
      voiceProfile: business.voice_profile,
      subreddit: sub.subreddit_name,
      subredditTitle: about.title,
      subredditDescription: about.public_description,
      submitText: about.submit_text,
      rules,
    });

    const lastSuggested = sub.last_suggested_at
      ? new Date(sub.last_suggested_at).toISOString().slice(0, 10)
      : 'never';
    const chosenReason = `Least-recently-suggested active subreddit for ${business.name} (last suggested: ${lastSuggested}; cooldown ${config.suggestionCooldownDays} days).`;

    await pool.query(
      `INSERT INTO post_suggestions
         (business_id, subreddit_name, rules_json, submit_text, chosen_reason,
          key_rules_summary, post_title, post_body, unverified_flags, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new')`,
      [
        business.id,
        sub.subreddit_name,
        JSON.stringify(rules),
        about.submit_text,
        chosenReason,
        result.keyRulesSummary,
        result.title,
        result.body,
        result.unverifiedFlags,
      ]
    );

    await pool.query(`UPDATE subreddits SET last_suggested_at = now() WHERE id = $1`, [sub.id]);

    console.log(`[suggestion] created suggestion for r/${sub.subreddit_name} (${business.name})`);
    return { created: true, subreddit: sub.subreddit_name, business: business.name };
  } catch (err) {
    const msg = `suggestion for r/${sub.subreddit_name}: ${(err as Error).message}`;
    console.error(`[suggestion] ${msg}`);
    return { created: false, error: msg };
  }
}
