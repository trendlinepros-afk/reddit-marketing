import { getPool, closePool } from '../db';
import { RedditClient } from '../reddit/client';
import { runScanner } from '../pipeline/scanner';
import { generateDrafts } from '../pipeline/drafts';
import { generateDailySuggestion } from '../pipeline/suggestion';
import { sendDailyDigest } from '../email/digest';

/**
 * The full daily pipeline: scan → relevance/drafts → post suggestion → digest.
 * Designed to run as a one-shot process (Railway cron) or be invoked from
 * the node-cron scheduler in always-on mode.
 */
export async function runDailyJob(): Promise<void> {
  const pool = getPool();
  const reddit = new RedditClient();

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_runs DEFAULT VALUES RETURNING id`
  );
  const runId = rows[0].id;
  const errors: string[] = [];

  let postsChecked = 0;
  let newMatches = 0;
  let draftsCreated = 0;

  try {
    const scan = await runScanner(pool, reddit);
    postsChecked = scan.postsChecked;
    newMatches = scan.newMatches;
    errors.push(...scan.errors);

    const drafts = await generateDrafts(pool);
    draftsCreated = drafts.draftsCreated;
    errors.push(...drafts.errors);

    const suggestion = await generateDailySuggestion(pool, reddit);
    if (!suggestion.created && suggestion.error) errors.push(suggestion.error);

    await sendDailyDigest(pool);
  } catch (err) {
    errors.push(`fatal: ${(err as Error).message}`);
    throw err;
  } finally {
    await pool.query(
      `UPDATE scan_runs
       SET finished_at = now(), posts_checked = $1, new_matches = $2, drafts_created = $3, errors = $4
       WHERE id = $5`,
      [postsChecked, newMatches, draftsCreated, errors.join('\n'), runId]
    );
  }
}

// One-shot entrypoint for `npm run job:daily` (Railway cron)
if (require.main === module) {
  runDailyJob()
    .then(async () => {
      console.log('[daily] job complete');
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[daily] job failed:', err);
      await closePool();
      process.exit(1);
    });
}
