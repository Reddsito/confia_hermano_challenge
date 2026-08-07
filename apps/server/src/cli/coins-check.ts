/**
 * End-to-end check of the coin economy against a throwaway in-memory database.
 *
 * The rules that matter here — the daily cap, the wallet ceiling, the top-up
 * when today's income was clamped away, the spectator's licence to exceed the
 * cap, and the epoch anchor that stops back pay — are all order-dependent, and
 * none of them can be exercised by the pure unit tests in packages/core because
 * they only exist once a ledger is involved.
 *
 * Run with `pnpm --filter @challenge/server coins:check`. Pass `--live` to skip
 * the simulation and audit the real database instead.
 */
import { bootstrap } from './bootstrap';
import { openDatabase } from '../db/index';
import {
  auditCoinLedger,
  coinBalance,
  coinWallet,
  creditCoins,
  debitCoins,
  ensureAccrual,
  grantWinCoin,
} from '../db/coins';
import { placeBet, settleBetsForMatch, voidStaleBets, balanceForHolder } from '../db/bets';

if (process.argv.includes('--live')) {
  const { db: live } = bootstrap();
  const problems = auditCoinLedger(live);

  if (problems.length === 0) {
    console.log('\nLedger de monedas sano: nada que reportar.\n');
  } else {
    console.log(`\n${problems.length} problema(s):\n`);
    for (const problem of problems) console.log(`  - ${problem}`);
    console.log('');
    process.exitCode = 1;
  }

  process.exit(process.exitCode ?? 0);
}

const db = openDatabase(':memory:');
const DAY = 86_400_000;
const t0 = Date.parse('2026-08-06T18:00:00.000Z'); // 1pm Panama

function ok(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${pass ? '' : ` (esperado ${JSON.stringify(expected)})`}`);
  if (!pass) process.exitCode = 1;
}

db.prepare(
  `INSERT INTO players (id, display_name, game_name, tag_line, role, status, puuid, created_at)
   VALUES ('p1','Ana','A','LAS','MID','approved','pu1',?), ('p2','Beto','B','LAS','TOP','approved','pu2',?)`,
).run(String(t0), String(t0));

db.prepare(
  `INSERT INTO discord_users (discord_id, username, player_id, first_seen, last_seen, is_spectator)
   VALUES ('d1','ana','p1',?,?,0), ('d2','beto','p2',?,?,0), ('d3','espec',NULL,?,?,1)`,
).run(t0, t0, t0, t0, t0, t0);

// --- day one accrual -------------------------------------------------------
ensureAccrual(db, 'd1', t0);
ensureAccrual(db, 'd3', t0);
ok('jugador cobra 1 el día 1', coinBalance(db, 'd1'), 1);
ok('espectador cobra 3 el día 1', coinBalance(db, 'd3'), 3);

// Idempotent: reading twice must not pay twice.
ensureAccrual(db, 'd1', t0);
ok('acreditación idempotente', coinBalance(db, 'd1'), 1);

// --- wins, and the five-a-day cap -----------------------------------------
for (let i = 0; i < 6; i += 1) grantWinCoin(db, 'p1', `M${i}`, t0);
ok('tope diario de 5', coinWallet(db, 'd1', t0).earnedToday, 5);
ok('balance al tope diario', coinBalance(db, 'd1'), 5);

// --- next day --------------------------------------------------------------
const t1 = t0 + DAY;
ensureAccrual(db, 'd1', t1);
ok('día 2 suma exactamente 1', coinBalance(db, 'd1'), 6);
ok('el contador diario se reinicia', coinWallet(db, 'd1', t1).earnedToday, 1);

// --- the wallet ceiling ----------------------------------------------------
creditCoins(db, 'd1', { source: 'ADMIN', ref: 'top', amount: 20, detail: 'test', now: t1 });
ok('el techo corta en 15', coinBalance(db, 'd1'), 15);

// A full player earns nothing more that day.
const t2 = t1 + DAY;
ensureAccrual(db, 'd1', t2);
ok('lleno = sin ingreso', coinBalance(db, 'd1'), 15);

// ...but spending re-opens the same day (the top-up path).
debitCoins(db, 'd1', { source: 'SHOP_SHELL', ref: 'buy1', amount: 15, now: t2 });
ok('compra deja el wallet en 0', coinBalance(db, 'd1'), 0);
ensureAccrual(db, 'd1', t2);
ok('el día se recupera tras gastar', coinBalance(db, 'd1'), 1);

// --- betting ---------------------------------------------------------------
creditCoins(db, 'd1', { source: 'ADMIN', ref: 'stake-funds', amount: 13, now: t2 });
ok('fondeado a 14', coinBalance(db, 'd1'), 14);


const bet = placeBet(db, {
  discordId: 'd1', playerId: 'p2', gameId: '999',
  market: 'WIN', selection: 'GANA', stake: 2,
});
ok('el stake sale al apostar', coinBalance(db, 'd1'), 12);

// Winning at 12 with a gross of 4 fits under the ceiling.
settleBetsForMatch(db, 'p2', 'LA1_999', {
  win: true, kills: 5, firstBlood: false, durationMinutes: 25,
});
ok('pago de apuesta ganada', coinBalance(db, 'd1'), 16 > 15 ? 15 : 16);
ok('payout registrado = lo acreditado',
  (db.prepare('SELECT payout FROM bets WHERE id = ?').get(bet.id) as { payout: number }).payout, 3);

// --- spectator bypasses the ceiling ---------------------------------------
creditCoins(db, 'd3', { source: 'ADMIN', ref: 'sp-top', amount: 20, now: t2 });
ok('espectador topa en 15 por ingreso', coinBalance(db, 'd3'), 15);
placeBet(db, { discordId: 'd3', playerId: 'p1', gameId: '888', market: 'WIN', selection: 'GANA', stake: 2 });
settleBetsForMatch(db, 'p1', 'LA1_888', {
  win: true, kills: 5, firstBlood: false, durationMinutes: 25,
});
ok('espectador SÍ se pasa de 15 ganando', coinBalance(db, 'd3'), 17);

// --- void refunds even at the ceiling -------------------------------------
const before = coinBalance(db, 'd3');
placeBet(db, { discordId: 'd3', playerId: 'p1', gameId: '777', market: 'WIN', selection: 'GANA', stake: 2 });
// Aged against the real clock, which is what voidStaleBets compares against.
db.prepare('UPDATE bets SET placed_at = 0 WHERE game_id = ?').run('777');
voidStaleBets(db, 3 * 3600_000);
ok('el void devuelve el stake sobre el techo', coinBalance(db, 'd3'), before);

// --- one bet per game ------------------------------------------------------
let dupe = false;
try {
  placeBet(db, { discordId: 'd1', playerId: 'p2', gameId: '999', market: 'KILLS_13', selection: 'MAS_13', stake: 1 });
} catch { dupe = true; }
ok('una sola apuesta por partida (cualquier mercado)', dupe, true);

// --- no debt ---------------------------------------------------------------
// d2 accrues its daily coin the moment the debit touches the wallet, so the
// charge has to be bigger than a day's income to be refused.
ok('no se puede gastar de más', debitCoins(db, 'd2', { source: 'BET_STAKE', ref: 'x', amount: 5 }), false);
ok('el balance nunca queda negativo', coinBalance(db, 'd2') >= 0, true);
ok('las conchas no quedan negativas', balanceForHolder(db, 'd1').available >= 0, true);

// --- the epoch anchor ------------------------------------------------------
// An account that existed long before monedas did must not be handed back pay
// for every day since it joined. This is the single riskiest detail: get it
// wrong and everybody wakes up at the ceiling.
db.prepare(
  `INSERT INTO discord_users (discord_id, username, player_id, first_seen, last_seen, is_spectator)
   VALUES ('d4','viejo',NULL,?,?,1)`,
).run(t0 - 400 * DAY, t0);
ensureAccrual(db, 'd4', t0);
ok('una cuenta vieja no cobra retroactivo', coinBalance(db, 'd4'), 3);

// The audit runs over the ledger this simulation just built, so the checker
// itself is exercised rather than only ever pointed at production.
const audit = auditCoinLedger(db);
ok('la auditoría no encuentra nada roto', audit, []);

console.log(process.exitCode ? '\nFALLÓ' : '\nTodo OK');
