import type { DiscordEmbed } from './embeds';

export type DiscordEvent =
  | 'in_game'
  | 'match_finished'
  | 'rank_change'
  | 'new_leader'
  | 'shell_thrown';

export interface DiscordConfig {
  webhookUrl: string;
  /** Which event types actually get posted. */
  events: Set<DiscordEvent>;
  username: string;
  avatarUrl?: string;
}

interface Queued {
  event: DiscordEvent;
  embed: DiscordEmbed;
}

/** Discord accepts at most 10 embeds per message. */
const MAX_EMBEDS_PER_MESSAGE = 10;

/**
 * Collects everything that happened during a cycle and posts it in as few
 * messages as possible. Batching matters: a cycle that finds six finished games
 * would otherwise fire six requests and hit Discord's webhook rate limit.
 *
 * Every failure is swallowed. A broken webhook must never stop the leaderboard
 * from updating — notifications are a nicety, the data is the product.
 */
export class DiscordNotifier {
  private queue: Queued[] = [];

  constructor(private readonly config: DiscordConfig | null) {}

  get enabled(): boolean {
    return this.config !== null;
  }

  wants(event: DiscordEvent): boolean {
    return this.config?.events.has(event) ?? false;
  }

  push(event: DiscordEvent, embed: DiscordEmbed): void {
    if (!this.wants(event)) return;
    this.queue.push({ event, embed });
  }

  async flush(): Promise<void> {
    if (!this.config || this.queue.length === 0) return;

    const pending = this.queue;
    this.queue = [];

    for (let i = 0; i < pending.length; i += MAX_EMBEDS_PER_MESSAGE) {
      const batch = pending.slice(i, i + MAX_EMBEDS_PER_MESSAGE);
      await this.send(batch.map((item) => item.embed));
    }
  }

  private async send(embeds: DiscordEmbed[]): Promise<void> {
    if (!this.config) return;

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.config.username,
          avatar_url: this.config.avatarUrl,
          embeds,
        }),
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? '2');
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        await this.send(embeds);
        return;
      }

      if (!response.ok) {
        console.warn(
          `[discord] webhook responded ${response.status}: ${await response
            .text()
            .catch(() => '')}`,
        );
      }
    } catch (error) {
      console.warn('[discord] could not post:', error);
    }
  }
}

const ALL_EVENTS: DiscordEvent[] = [
  'in_game',
  'match_finished',
  'rank_change',
  'new_leader',
  'shell_thrown',
];

/** Parses DISCORD_EVENTS, defaulting to everything except the noisy one. */
export function parseEvents(raw: string): Set<DiscordEvent> {
  if (!raw.trim()) {
    return new Set(ALL_EVENTS.filter((event) => event !== 'in_game'));
  }
  if (raw.trim() === 'all') return new Set(ALL_EVENTS);

  const requested = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is DiscordEvent =>
      ALL_EVENTS.includes(value as DiscordEvent),
    );

  return new Set(requested);
}
