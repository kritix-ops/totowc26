// One-off: repairs custom_bets.lock_at for every scope='tournament' bet
// whose lock_at deviates from the expected value derived from settings +
// bet_lock_defaults. The bug: when these 8 bets were created on
// 2026-05-27, settings.tournament_start_at wasn't set yet, so the admin
// preview anchored on the first known kickoff at that time (which happened
// to be a 2026-06-28 fixture) and the resulting lock_at was saved on every
// tournament-scope bet. tournament_start_at has since been set correctly
// (2026-06-11T19:00:00Z), but the per-row lock_at never got recomputed.
//
// Expected lock_at = settings.tournament_start_at
//                  - bet_lock_defaults.offset_minutes WHERE bet_type='custom_tournament'
//
// Idempotent: every run recomputes the expected value and only writes
// rows that still differ. Safe to re-run.
//
// Does NOT touch user_custom_bet_picks. See memory
// feedback_user_bets_are_sacred — only custom_bets.lock_at moves.

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('[fix tournament lock-at] missing SUPABASE env. abort.');
  process.exit(1);
}
const s = createClient(url, key);

const MS_PER_MINUTE = 60_000;

const [settingsRes, defaultRes, betsRes] = await Promise.all([
  s.from('settings').select('tournament_start_at').eq('id', 1).single(),
  s.from('bet_lock_defaults').select('offset_minutes').eq('bet_type', 'custom_tournament').single(),
  s.from('custom_bets').select('id, question_he, lock_at, status').eq('scope', 'tournament'),
]);

if (settingsRes.error || !settingsRes.data?.tournament_start_at) {
  console.error('[fix tournament lock-at] settings.tournament_start_at missing or unreadable', settingsRes.error);
  process.exit(1);
}
if (defaultRes.error || defaultRes.data?.offset_minutes == null) {
  console.error('[fix tournament lock-at] bet_lock_defaults.custom_tournament missing', defaultRes.error);
  process.exit(1);
}

const tournamentStartMs = new Date(settingsRes.data.tournament_start_at).getTime();
const offsetMinutes = defaultRes.data.offset_minutes;
const expectedLockMs = tournamentStartMs - offsetMinutes * MS_PER_MINUTE;
const expectedLockIso = new Date(expectedLockMs).toISOString();

console.info('[fix tournament lock-at] context', {
  tournamentStartAt: settingsRes.data.tournament_start_at,
  offsetMinutes,
  expectedLockAt: expectedLockIso,
  totalTournamentBets: betsRes.data?.length ?? 0,
});

const drift = (betsRes.data ?? []).filter((b) => {
  const actualMs = new Date(b.lock_at).getTime();
  return Math.abs(actualMs - expectedLockMs) >= 60 * 1000;
});

if (drift.length === 0) {
  console.info('[fix tournament lock-at] no drift detected. nothing to update.');
  process.exit(0);
}

console.info('[fix tournament lock-at] rows to repair', drift.map((b) => ({
  id: b.id,
  status: b.status,
  was: b.lock_at,
  now: expectedLockIso,
  question: b.question_he,
})));

const { data: updated, error: updErr } = await s
  .from('custom_bets')
  .update({ lock_at: expectedLockIso })
  .in('id', drift.map((b) => b.id))
  .select('id, lock_at, question_he');

if (updErr) {
  console.error('[fix tournament lock-at] update failed', updErr);
  process.exit(1);
}

console.info('[fix tournament lock-at] updated', updated?.length ?? 0, 'rows');
for (const row of updated ?? []) {
  console.info('  ✓', row.id, '|', row.lock_at, '|', row.question_he);
}
