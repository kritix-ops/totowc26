# Opener live-bet loss refund (the "first-day screw-up")

Date: 2026-06-15
Owner: Yoav
Status: approved (Option 2), executing

## Background

On the WC opener (2026-06-11) the live (in-match) prop markets launched with
flat odds. The 7 opener bets (Mexico vs South Africa) were graded that night
at flat odds, then on 2026-06-12 they were **retroactively re-settled** at
corrected per-side odds with the payout ceiling lifted (see
`bet_grading_audit` rows reasoned "Retroactive per-side re-pricing ... no
ceiling"). That intervention recomputed the **winners** and left the
**losers** untouched. The house-edge refund script the same day also only
credited winners (it skips `was_correct <> true`).

Net effect today: every retroactive fix on the opener credited points to
people who won; nobody who lost got anything back. That asymmetry is the
fairness gap we are closing.

See the analysis run in
`scripts/one-off/audit-opener-live-bets-2026-06-15.mjs` (read-only).

## Decision (locked with Yoav)

Refund the **losing stakes** on the 7 re-priced opener bets. Do NOT void
(would claw back 344 pts of correctly-priced, already-celebrated winnings)
and do NOT touch winners. This completes the June 12 fix symmetrically:
winners were re-priced, losers get their stake back.

Numbers (from the audit, 7 bets identified by their re-pricing audit rows):

- 31 losing picks across **13 users**, total **110 points**.
- Biggest: שרון 30 (the only loss above the new 10-pt cap), לנדאו 18,
  Yakir 11, ג'ניה 9, הקוף 9, ערן 8, then 5 more at 2-5.

## How the refund is written

`scripts/one-off/refund-opener-loss-2026-06-15.mjs`:

- One `point_adjustments` row **per affected user**, `delta = sum of that
  user's losing stake on the 7 bets`, so each user sees a single clean
  "+N · refund" line rather than one row per pick.
- `created_by` = admin (Yoav), same id the house-edge refund used.
- `reason` = a clear Hebrew label (see below). The reason is the single
  source of the on-screen text on every surface.
- **Idempotent**: before writing, load every `point_adjustments` row whose
  `reason` equals this exact string and skip any user already refunded.
  Re-running writes nothing.
- DRY-RUN by default; `--apply` writes.

Reason string (shown verbatim on the leaderboard + bank history):

> החזר נקודות · באג הימורי הלייב במשחק הפתיחה (11.6). היחסים היו שבורים, אז
> הוחזר הסכום שהופסד.

## Why this lands where Yoav wants it, mostly with no UI code

`point_adjustments` flows into the **overall** bank balance and the overall
leaderboard score (queries.ts `bankBalanceSql` / `getLeaderboard` overall
branch). It is intentionally NOT in the "live" category tab score
(`live_payouts - live_stakes`), which is correct: the live-skill board
should reflect bets actually won, and these were genuine losses being made
whole at the money level, not re-scored as wins.

Visible, with the label, automatically:

- **Leaderboard accordion** ("recent score per user"): renders adjustments
  as a green `+N` row, chip "התאמה", title = the reason. A row dated today
  shows in the "היום/Today" group. (LeaderboardRow.tsx + queries
  `loadLeaderboardBreakdownsFromDb` already union `point_adjustments`.)
- **/me/bank** transactions: shows "התאמת אדמין" + the reason as detail.

Needs a small change:

- **/transparency player-history** (`getUserBetHistory` +
  `UserHistoryProfile`): today this timeline is bet-only and excludes
  adjustments. Add an adjustments branch that renders the refund as its own
  card (chip "התאמה", the reason as the line, a `+N` chip) WITHOUT faking a
  pick/result, and WITHOUT polluting the win/loss/bet-count summary (it
  counts toward net only). Contained via an `isAdjustment` flag on
  `UserHistoryRow`; the shared `TransparencyCategory` enum is left untouched.

## Security / safety

- Production points write. Mitigations: read-only audit verified the set
  first; dry-run prints every row before `--apply`; idempotent dedup by
  exact reason; one transaction-free additive write per user (no balance
  recompute, no deletes). `point_adjustments` is append-only in practice
  here (we never UPDATE/DELETE).
- No secrets logged. Connection via `DIRECT_URL`/`DATABASE_URL` from
  `.env.local`, same as the existing one-off scripts.

## Out of scope / noted

- One unrelated cancelled bet (2026-06-14 "מתי ייפול השער הראשון") still has
  5 picks debiting 9 pts total because cancellation didn't refund stakes.
  Separate small bug; fix independently.
- The "live" leaderboard tab's accordion already shows adjustment events
  whose delta is not in that tab's score (pre-existing behavior for the
  house-edge refunds). Not changed here.
