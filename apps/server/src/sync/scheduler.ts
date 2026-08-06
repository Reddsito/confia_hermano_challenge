import { RiotClient } from '@challenge/core/riot';

import { DiscordNotifier } from '../discord/notifier';
import { shellStolenEmbed } from '../discord/embeds';
import { listPlayers } from '../db/players';
import { mentionFor } from '../db/users';
import { resolveSteals } from '../db/shells';
import { voidStaleBets } from '../db/bets';

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

  /** When the next tick fires. The countdown on the site reads this. */
  private nextRunAt = 0;

  start(): void {
    const intervalMs = this.config.tournament.refreshIntervalMinutes * 60_000;
    console.log(
      `[scheduler] every ${this.config.tournament.refreshIntervalMinutes} min ` +
        `(${this.config.useMockData ? 'mock' : 'riot'})` +
        `${this.notifier.enabled ? ' · discord on' : ''}`,
    );

    this.nextRunAt = Date.now() + intervalMs;
    void this.runCycle();

    this.timer = setInterval(() => {
      // Recorded before the work starts, so it reflects the tick schedule
      // rather than however long this particular cycle happens to take.
      this.nextRunAt = Date.now() + intervalMs;
      void this.runCycle();
    }, intervalMs);
  }

  /** Resolves duels between tracked players and announces the outcome. */
  /**
   * Returns stakes on games that never produced a match row.
   *
   * A dodge, a remake, or a game the ingest simply never saw would otherwise
   * leave a stake locked forever, which to the bettor is indistinguishable from
   * a shell that vanished. Three hours is well past the longest game anyone has
   * played, so nothing still live is touched.
   */
  private voidAbandonedBets(): void {
    const voided = voidStaleBets(this.db, 3 * 60 * 60 * 1000);
    if (voided > 0) console.log(`[bets] ${voided} stale wager(s) returned`);
  }

  private settleSteals(): void {
    const names = new Map(
      listPlayers(this.db, 'approved').map((player) => [
        player.id,
        player.displayName,
      ]),
    );

    for (const steal of resolveSteals(this.db)) {
      const winner = names.get(steal.winnerId) ?? 'Someone';
      const loser = names.get(steal.loserId) ?? 'someone';

      console.log(
        `[shells] ${winner} ${steal.kept ? 'stole' : 'destroyed'} ${loser}'s shell`,
      );

      const mention = mentionFor(this.db, steal.loserId);

      this.notifier.push(
        'shell_stolen',
        shellStolenEmbed(winner, loser, steal.kept, {
          tournamentName: this.config.tournament.name,
          siteUrl: this.config.siteUrl || undefined,
          opggUrl: this.config.siteUrl || '',
          profileIconId: null,
        }),
        mention
          ? `${mention} perdiste tu Blue Shell contra ${winner}`
          : undefined,
      );
    }
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

      // After ingestion, so both sides of a duel are on record before it is
      // settled — the two players are fetched independently.
      if (!this.config.useMockData) {
        this.settleSteals();
        this.voidAbandonedBets();
      }

      markCycleComplete(
        this.db,
        this.nextRunAt ||
          Date.now() + this.config.tournament.refreshIntervalMinutes * 60_000,
      );
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
