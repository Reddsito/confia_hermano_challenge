import type { DiscordEmbed } from './embeds';

export type DiscordEvent =
  | 'in_game'
  | 'match_finished'
  | 'rank_change'
  | 'new_leader'
  | 'shell_thrown'
  | 'challenge_served'
  | 'shell_stolen';

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
  /**
   * Plain text sent alongside the embed. Mentions only notify from here —
   * Discord never pings for a mention written inside an embed.
   */
  content?: string;
  /**
   * Whether this message may ping the whole server. Reserved for the rare
   * events that genuinely warrant it.
   */
  everyone?: boolean;
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

  push(
    event: DiscordEvent,
    embed: DiscordEmbed,
    content?: string,
    everyone = false,
  ): void {
    if (!this.wants(event)) return;
    this.queue.push({ event, embed, content, everyone });
  }

  async flush(): Promise<void> {
    if (!this.config || this.queue.length === 0) return;

    const pending = this.queue;
    this.queue = [];

    // Anything allowed to ping the server is sent on its own. Batching it with
    // ordinary messages would extend that permission to their text too, and a
    // challenge named "@everyone do pushups" would reach the whole server.
    const loud = pending.filter((item) => item.everyone);
    const normal = pending.filter((item) => !item.everyone);

    for (const item of loud) {
      await this.send([item.embed], item.content, true);
    }

    for (let i = 0; i < normal.length; i += MAX_EMBEDS_PER_MESSAGE) {
      const batch = normal.slice(i, i + MAX_EMBEDS_PER_MESSAGE);
      const content = batch
        .map((item) => item.content)
        .filter(Boolean)
        .join('\n');

      await this.send(
        batch.map((item) => item.embed),
        content || undefined,
      );
    }
  }

  private async send(
    embeds: DiscordEmbed[],
    content?: string,
    everyone = false,
  ): Promise<void> {
    if (!this.config) return;

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.config.username,
          avatar_url: this.config.avatarUrl,
          content,
          // Explicitly enumerated: without this, an @everyone typed into a
          // challenge name would ping the whole server.
          allowed_mentions: {
            parse: everyone ? ['users', 'everyone'] : ['users'],
          },
          embeds,
        }),
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? '2');
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        await this.send(embeds, content, everyone);
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
  'challenge_served',
  'shell_stolen',
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
