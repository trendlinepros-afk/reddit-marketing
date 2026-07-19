import cron from 'node-cron';
import { config } from './config';
import { getPool } from './db';
import { runDailyJob } from './jobs/daily';
import { startWebServer } from './web/server';

/**
 * Always-on mode: serves the admin dashboard and fires the daily pipeline on
 * a cron schedule with proper timezone handling (10am America/New_York by
 * default, so EST/EDT transitions are handled automatically).
 *
 * Alternative: Railway's built-in cron on a service whose start command is
 * `npm run job:daily` — see README. That mode has no dashboard because the
 * process exits after each run.
 */
let running = false;

startWebServer(getPool());

console.log(
  `[reddit-marketer] scheduler started — cron "${config.cronSchedule}" tz ${config.cronTimezone}`
);

cron.schedule(
  config.cronSchedule,
  async () => {
    if (running) {
      console.log('[reddit-marketer] previous run still in progress; skipping this tick');
      return;
    }
    running = true;
    try {
      await runDailyJob();
    } catch (err) {
      console.error('[reddit-marketer] daily job failed:', err);
    } finally {
      running = false;
    }
  },
  { timezone: config.cronTimezone }
);
