import { getPool, closePool } from '../db';

/**
 * Minimal admin CLI for v1 — manage businesses, subreddits, keywords, and
 * the manual feedback loop (marking matches responded/ignored).
 *
 * Usage: npm run admin -- <command> [args]
 *
 *   business:add "<name>" "<domain>" "<voice profile>" [anthropic|gemini]
 *   business:list
 *   business:toggle <id> <true|false>
 *   subreddit:add <business_id> <subreddit_name>
 *   subreddit:list [business_id]
 *   subreddit:toggle <id> <true|false>
 *   keyword:add <business_id> "<phrase>"
 *   keyword:list [business_id]
 *   keyword:toggle <id> <true|false>
 *   match:list [status]
 *   match:show <id>
 *   match:status <id> <responded|ignored|new>
 *   suggestion:list
 *   suggestion:status <id> <posted|skipped>
 *   runs:list
 */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const pool = getPool();

  switch (command) {
    case 'business:add': {
      const [name, domain, voiceProfile, provider = 'anthropic'] = args;
      if (!name) throw new Error('Usage: business:add "<name>" "<domain>" "<voice profile>" [anthropic|gemini]');
      const { rows } = await pool.query(
        `INSERT INTO businesses (name, domain, voice_profile, ai_provider) VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, domain ?? '', voiceProfile ?? '', provider]
      );
      console.log(`Created business #${rows[0].id}: ${name}`);
      break;
    }
    case 'business:list': {
      const { rows } = await pool.query(
        `SELECT id, name, domain, ai_provider, active FROM businesses ORDER BY id`
      );
      console.table(rows);
      break;
    }
    case 'business:toggle': {
      const [id, active] = args;
      await pool.query(`UPDATE businesses SET active = $1 WHERE id = $2`, [active === 'true', id]);
      console.log(`Business ${id} active=${active}`);
      break;
    }

    case 'subreddit:add': {
      const [businessId, name] = args;
      if (!businessId || !name) throw new Error('Usage: subreddit:add <business_id> <subreddit_name>');
      const clean = name.replace(/^\/?r\//, '');
      const { rows } = await pool.query(
        `INSERT INTO subreddits (business_id, subreddit_name) VALUES ($1, $2) RETURNING id`,
        [businessId, clean]
      );
      console.log(`Added r/${clean} (#${rows[0].id}) to business ${businessId}`);
      break;
    }
    case 'subreddit:list': {
      const [businessId] = args;
      const { rows } = await pool.query(
        businessId
          ? `SELECT * FROM subreddits WHERE business_id = $1 ORDER BY id`
          : `SELECT * FROM subreddits ORDER BY business_id, id`,
        businessId ? [businessId] : []
      );
      console.table(rows);
      break;
    }
    case 'subreddit:toggle': {
      const [id, active] = args;
      await pool.query(`UPDATE subreddits SET active = $1 WHERE id = $2`, [active === 'true', id]);
      console.log(`Subreddit ${id} active=${active}`);
      break;
    }

    case 'keyword:add': {
      const [businessId, phrase] = args;
      if (!businessId || !phrase) throw new Error('Usage: keyword:add <business_id> "<phrase>"');
      const { rows } = await pool.query(
        `INSERT INTO keywords (business_id, phrase) VALUES ($1, $2) RETURNING id`,
        [businessId, phrase]
      );
      console.log(`Added keyword "${phrase}" (#${rows[0].id}) to business ${businessId}`);
      break;
    }
    case 'keyword:list': {
      const [businessId] = args;
      const { rows } = await pool.query(
        businessId
          ? `SELECT * FROM keywords WHERE business_id = $1 ORDER BY id`
          : `SELECT * FROM keywords ORDER BY business_id, id`,
        businessId ? [businessId] : []
      );
      console.table(rows);
      break;
    }
    case 'keyword:toggle': {
      const [id, active] = args;
      await pool.query(`UPDATE keywords SET active = $1 WHERE id = $2`, [active === 'true', id]);
      console.log(`Keyword ${id} active=${active}`);
      break;
    }

    case 'match:list': {
      const [status] = args;
      const { rows } = await pool.query(
        status
          ? `SELECT id, business_id, subreddit_name, post_title, matched_keyword, status, found_at
             FROM matches WHERE status = $1 ORDER BY found_at DESC LIMIT 50`
          : `SELECT id, business_id, subreddit_name, post_title, matched_keyword, status, found_at
             FROM matches ORDER BY found_at DESC LIMIT 50`,
        status ? [status] : []
      );
      console.table(rows);
      break;
    }
    case 'match:show': {
      const [id] = args;
      const { rows } = await pool.query(`SELECT * FROM matches WHERE id = $1`, [id]);
      console.log(JSON.stringify(rows[0], null, 2));
      break;
    }
    case 'match:status': {
      const [id, status] = args;
      if (!['responded', 'ignored', 'new'].includes(status)) {
        throw new Error('Usage: match:status <id> <responded|ignored|new>');
      }
      await pool.query(`UPDATE matches SET status = $1 WHERE id = $2`, [status, id]);
      console.log(`Match ${id} → ${status}`);
      break;
    }

    case 'suggestion:list': {
      const { rows } = await pool.query(
        `SELECT id, business_id, subreddit_name, post_title, status, created_at
         FROM post_suggestions ORDER BY created_at DESC LIMIT 30`
      );
      console.table(rows);
      break;
    }
    case 'suggestion:status': {
      const [id, status] = args;
      if (!['posted', 'skipped'].includes(status)) {
        throw new Error('Usage: suggestion:status <id> <posted|skipped>');
      }
      await pool.query(`UPDATE post_suggestions SET status = $1 WHERE id = $2`, [status, id]);
      console.log(`Suggestion ${id} → ${status}`);
      break;
    }

    case 'runs:list': {
      const { rows } = await pool.query(
        `SELECT id, started_at, finished_at, posts_checked, new_matches, drafts_created,
                CASE WHEN errors = '' THEN '' ELSE left(errors, 120) END AS errors
         FROM scan_runs ORDER BY id DESC LIMIT 20`
      );
      console.table(rows);
      break;
    }

    default:
      console.log(`Unknown command: ${command ?? '(none)'}\n`);
      console.log(`Commands:
  business:add "<name>" "<domain>" "<voice profile>" [anthropic|gemini]
  business:list | business:toggle <id> <true|false>
  subreddit:add <business_id> <name> | subreddit:list [business_id] | subreddit:toggle <id> <true|false>
  keyword:add <business_id> "<phrase>" | keyword:list [business_id] | keyword:toggle <id> <true|false>
  match:list [status] | match:show <id> | match:status <id> <responded|ignored|new>
  suggestion:list | suggestion:status <id> <posted|skipped>
  runs:list`);
  }
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(err.message ?? err);
    await closePool();
    process.exit(1);
  });
