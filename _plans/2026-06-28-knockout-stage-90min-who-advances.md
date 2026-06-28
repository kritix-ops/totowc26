# Knockout stages: stage labels, 90' match predictions, "who advances", 120' live bets

Date: 2026-06-28
Branch: `sandbox` (do NOT touch `master`/production until explicitly approved)
Status: approved, in progress

## Goals (from the user)

1. Show the tournament stage on each match-prediction card ("שלב 32 האחרונות", "שמינית גמר", etc.).
2. Keep the direction + exact-score prediction graded on **90 minutes** (regulation), not 120.
   The 120-minute / extra-time outcome is covered by **live bets**, which must be updated
   accordingly (grade on the true final result incl. extra time; add ET/penalty markets).
3. Add a new prediction on knockout cards: **"מי עולה?"** — pick the team that advances.
   A hit is worth **10 points**, editable globally from admin.

## Decisions (locked with the user)

- **Live-bet scope:** full. Persist extra-time score, penalty score, and the winner flag;
  fix live grading to use the true final result; add auto-grading markets for common
  knockout questions (went to ET, went to penalties, winner incl. ET, who advances).
- **"Who advances" points:** a single global editable setting (`scoring_advance`, default 10)
  in `/admin/settings/scoring`, mirroring `scoring_exact` / `scoring_outcome`.
- **Score-storage architecture: Option A.** `matches.home_score/away_score` hold the
  **final result including extra time** (what display + live grading already read as "the
  result"). Add `reg_home_score/reg_away_score` (90' regulation) used only by the
  match-prediction grader. Add `pen_home_score/pen_away_score` and an advancing-team marker.
- **"Who advances" storage:** a **separate table `match_advance_bets`**, not new columns on
  `match_bets` (whose score columns are `NOT NULL`; relaxing that would touch many readers).
  Full isolation, zero risk to the existing score path.
- Add the explanatory line "הניחוש על 90 דקות" on knockout cards.

## Why Option A (rejected alternative: keep `home_score` = 90')

Display, live-bet grading (winner / total goals / over-under), and most readers already treat
`home_score/away_score` as "the result" and expect the true final. Only one consumer needs the
90' score: the match-prediction grader. Moving that one consumer to `reg_*` changes the fewest
call sites and carries the least risk. Keeping `home_score` = 90' would force every live-grading
branch and every display surface onto new "final" columns — more sites, easier to miss one.

## Data sources (verified)

- API-Football fixtures: `goals` = final incl. ET (excl. penalties); `score.fulltime` = 90'
  regulation; `score.extratime`; `score.penalty`; `teams.home.winner`/`teams.away.winner`
  = authoritative overall winner (true/false/null). Confirmed the `teams.winner` field exists.
- football-data fallback: `score.winner` (HOME_TEAM/AWAY_TEAM/DRAW), `score.duration`.

## Steps

1. Schema + migration: `matches.reg_home_score`, `reg_away_score`, `pen_home_score`,
   `pen_away_score`, `advancing_team` (varchar(3) → teams.code, null for group/unfinished);
   new `match_advance_bets`; `settings.scoring_advance smallint default 10`.
2. `api-football.ts` parser exposes `goals`, `fulltime`, `extratime`, `penalty`, `winner`
   separately; `sync.ts` writes all of them (and the football-data fallback).
3. `scoreFinalMatches` reads `reg_*` (falls back to `home_score` when null → identical for
   group matches).
4. New "who advances" grading loop: compare pick vs `advancing_team`, points from
   `settings.scoring_advance`; manual admin override of both the result and the points.
5. Live-bet grading: confirm result fields read the final score; add markets
   `went_to_extra_time`, winner-incl-penalties, who-advances (and keep `went_to_penalties`).
6. UI: stage label on every card; "מי עולה" picker on knockout cards only; past/locked states;
   "הניחוש על 90 דקות" helper line on knockout cards.
7. Admin: `scoring_advance` field in `/admin/settings/scoring`; manual override surface for
   the advancing team + per-result points on knockout matches.
8. Leaderboard: add `match_advance_bets.points_earned` to the match-score aggregate.
9. Unit tests: 90' grading of an ET knockout, who-advances correct/wrong, winner-incl-pens,
   parser mapping. `vitest run` must pass.

## Cross-cutting (per standing rules)

- Security: every override behind the existing admin-role check + audit trail; all new inputs validated.
- Observability: namespaced logs `[match advance score]`, `[sync score-source]` with real values.
- Settings: global `scoring_advance` (default 10) on the scoring page.
- Tests: step 9; full relevant suite green before done.
- Deploy: work on `sandbox`; no merge/push/promote to `master`/production without explicit
  approval; migration runs via the existing `prebuild → maybe-migrate` flow.
- Cost: none. Same API-Football call, only additional fields parsed from the same response.

## Known behavior flagged to the user

With predictions on 90', a knockout that is level at 90' grades as a draw for direction/exact —
a "draw" prediction can win even if the match was decided in extra time. This is intended;
"who advances" + live bets cover the extra-time outcome.
