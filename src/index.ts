import cron from 'node-cron';
import { config } from './config';
import { runDailyJob } from './jobs/daily';

/**
 * Always-on mode: keeps a process running and fires the daily pipeline on a
 * cron schedule with proper timezone handling (10am America/New_York by
 * default, so EST/EDT transitions are handled automatically).
 *
 * On Railway you can instead use the built-in cron scheduling on a service
 * whose start command is `npm run job:daily` — see README. Use this always-on
 * mode when you want exact local-time scheduling across DST changes.
 */
let running = false;

console.log(
  `[wicked-rc] scheduler started — cron "${config.cronSchedule}" tz ${config.cronTimezone}`
);

cron.schedule(
  config.cronSchedule,
  async () => {
    if (running) {
      console.log('[wicked-rc] previous run still in progress; skipping this tick');
      return;
    }
    running = true;
    try {
      await runDailyJob();
    } catch (err) {
      console.error('[wicked-rc] daily job failed:', err);
    } finally {
      running = false;
    }
  },
  { timezone: config.cronTimezone }
);
