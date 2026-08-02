import { bootstrap } from './bootstrap';
import { Scheduler } from '../sync/scheduler';

/** Runs exactly one refresh cycle and exits. Useful for cron or a smoke test. */
const { config, db } = bootstrap();
const report = await new Scheduler(db, config).runCycle();

if (!report) {
  console.error('[sync] cycle failed');
  process.exitCode = 1;
}
db.close();
