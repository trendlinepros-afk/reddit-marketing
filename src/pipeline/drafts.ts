import { Pool } from 'pg';
import { Business, Match } from '../types';
import { getAiProvider } from '../ai/factory';
import { config } from '../config';

export interface DraftStats {
  relevanceChecked: number;
  filteredOut: number;
  draftsCreated: number;
  errors: string[];
}

/**
 * For each new match without a draft: run the cheap relevance check first,
 * then generate a full reply draft only for matches that pass.
 * Matches that fail relevance are marked 'irrelevant' so they never
 * show up in a digest and are never re-checked.
 */
export async function generateDrafts(pool: Pool): Promise<DraftStats> {
  const stats: DraftStats = { relevanceChecked: 0, filteredOut: 0, draftsCreated: 0, errors: [] };

  const { rows: matches } = await pool.query<Match & Pick<Business, 'name' | 'domain' | 'voice_profile' | 'ai_provider'>>(
    `SELECT m.*, b.name, b.domain, b.voice_profile, b.ai_provider
     FROM matches m
     JOIN businesses b ON b.id = m.business_id
     WHERE m.status = 'new' AND m.ai_draft_response IS NULL AND b.active = TRUE
     ORDER BY m.found_at ASC
     LIMIT $1`,
    [config.maxDraftsPerRun]
  );

  for (const match of matches) {
    const provider = getAiProvider(match.ai_provider);
    try {
      stats.relevanceChecked++;
      const relevance = await provider.checkRelevance({
        businessName: match.name,
        businessDomain: match.domain,
        voiceProfile: match.voice_profile,
        keyword: match.matched_keyword,
        postTitle: match.post_title,
        postBody: match.post_body,
        subreddit: match.subreddit_name,
      });

      if (!relevance.relevant) {
        stats.filteredOut++;
        await pool.query(`UPDATE matches SET status = 'irrelevant' WHERE id = $1`, [match.id]);
        console.log(`[drafts] filtered match ${match.id} (${relevance.reason})`);
        continue;
      }

      const draft = await provider.draftReply({
        businessName: match.name,
        businessDomain: match.domain,
        voiceProfile: match.voice_profile,
        postTitle: match.post_title,
        postBody: match.post_body,
        subreddit: match.subreddit_name,
      });

      await pool.query(`UPDATE matches SET ai_draft_response = $1 WHERE id = $2`, [draft, match.id]);
      stats.draftsCreated++;
    } catch (err) {
      const msg = `draft for match ${match.id}: ${(err as Error).message}`;
      console.error(`[drafts] ${msg}`);
      stats.errors.push(msg);
      // Leave the match as 'new' with no draft — it will be retried next run.
    }
  }

  console.log(
    `[drafts] checked ${stats.relevanceChecked}, filtered ${stats.filteredOut}, drafted ${stats.draftsCreated}`
  );
  return stats;
}
