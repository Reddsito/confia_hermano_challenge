import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { QUEUE_IDS, loadConfig } from './config';
import { openDatabase } from './db/index';
import { listPlayers } from './db/players';
import { ensureRollingChallenges, seedDefaultChallenges } from './db/shells';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { liveRoutes } from './routes/live';
import { shellRoutes } from './routes/shells';
import { tierListRoutes } from './routes/tierlist';
import { clipRoutes } from './routes/clips';
import { signupRoutes } from './routes/signup';
import { betRoutes } from './routes/bets';
import { coinRoutes } from './routes/coins';
import { buildSnapshot } from './snapshot';
import { Scheduler } from './sync/scheduler';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  // No .env file — everything falls back to defaults or real env vars.
}

const config = loadConfig(ROOT);
const db = openDatabase(config.databasePath);
// The wheel must never be empty when someone spends a shell.
seedDefaultChallenges(db);
ensureRollingChallenges(db);
const scheduler = new Scheduler(db, config);

const app = new Hono();

/**
 * The frontend is deployed separately (Cloudflare Pages), so every browser
 * request to this API is cross-origin. Origins are allow-listed explicitly;
 * ALLOWED_ORIGINS=* is only meant for local development.
 */
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (config.allowedOrigins.includes('*')) return origin ?? '*';
      return config.allowedOrigins.includes(origin) ? origin : null;
    },
    // Every verb the API actually answers. A method missing here fails in the
    // preflight, so the request never reaches a route and never reaches the
    // log either — it just surfaces in the browser as a network error.
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

app.get('/api/health', (context) =>
  context.json({
    ok: true,
    source: config.useMockData ? 'mock' : 'riot',
    // The panel needs the platform to build OP.GG links.
    platform: config.platform,
    tournament: config.tournament.name,
    approved: listPlayers(db, 'approved').length,
  }),
);

app.get('/api/snapshot', (context) => {
  const snapshot = buildSnapshot(db, config);
  // Short cache: the data only changes once per cycle, and this keeps a busy
  // leaderboard from turning every viewer into a database read.
  context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
  return context.json(snapshot);
});

app.route('/api/auth', authRoutes(db, config));
app.route('/api/shells', shellRoutes(db, config));
app.route('/api/tierlist', tierListRoutes(db, config));
app.route('/api/clips', clipRoutes(db, config));
app.route('/api/signup', signupRoutes(db, config));
app.route('/api/bets', betRoutes(db, config));
app.route('/api/coins', coinRoutes(db, config));
app.route(
  '/api/live',
  liveRoutes(db, QUEUE_IDS[config.tournament.queue] ?? 420, config.platform),
);
app.route('/api/admin', adminRoutes(db, config, scheduler));

app.notFound((context) => context.json({ error: 'Not found' }, 404));

scheduler.start();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
  console.log(`[server] database: ${config.databasePath}`);
  console.log(`[server] cors: ${config.allowedOrigins.join(', ')}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n[server] ${signal} received, shutting down`);
    scheduler.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
