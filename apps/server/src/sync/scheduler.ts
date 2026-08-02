import { RiotClient } from '@challenge/core/riot';

import { DiscordNotifier } from '../discord/notifier';

import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import { markCycleComplete, recordPositions } from '../snapshot';
import { runMockCycle } from './mock';
import { runRiotCycle, type CycleReport } from './riot';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  /** Prevents a slow cycle from overlapping with the next tick. */
  private running = false;
  private readonly client: RiotClient | null;
  private readonly notifier: DiscordNotifier;

  constructor(
    private readonly db: Db,
    private readonly config: ServerConfig,
  ) {
    this.client = config.useMockData
      ? null
      : new RiotClient(config.riotApiKey, config.platform);
    this.notifier = new DiscordNotifier(config.discord);
  }

  start(): void {
    const intervalMs = this.config.tournament.refreshIntervalMinutes * 60_000;
    console.log(
      `[scheduler] every ${this.config.tournament.refreshIntervalMinutes} min ` +
        `(${this.config.useMockData ? 'mock' : 'riot'})` +
        `${this.notifier.enabled ? ' · discord on' : ''}`,
    );

    void this.runCycle();
    this.timer = setInterval(() => void this.runCycle(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runCycle(): Promise<CycleReport | null> {
    if (this.running) {
      console.warn('[scheduler] previous cycle still running, skipping tick');
      return null;
    }
    this.running = true;

    try {
      const report = this.client
        ? await runRiotCycle(this.db, this.client, this.config, this.notifier)
        : runMockCycle(this.db);

      markCycleComplete(this.db);
      recordPositions(this.db, this.config, this.notifier);

      // Sent after the data is committed, so a Discord outage can never delay
      // or roll back the leaderboard update.
      await this.notifier.flush();

      console.log(
        `[scheduler] ${report.updated}/${report.players} updated · ` +
          `${report.newMatches} new matches · ${report.failed} failed · ` +
          `${(report.durationMs / 1000).toFixed(1)}s`,
      );
      return report;
    } catch (error) {
      console.error('[scheduler] cycle failed:', error);
      return null;
    } finally {
      this.running = false;
    }
  }
}
