# PR 1 — World Cup zone enrichment: Tier 1 + Tier 2 data

Pre-approved by user, no council pass required.

## Goal

Add the highest-impact "wow" data from API-Football to "אזור המונדיאל"
*before* the tournament kicks off, so on day one players see a rich,
information-dense surface instead of empty placeholders.

## What ships in this PR

1. **Top scorers** from API-Football (replaces the football-data fallback we use today).
2. **Top assists** — new card in the Summary tab.
3. **Top yellow cards** — new card in the Summary tab.
4. **Injuries banner** — Summary tab, surfaces players who'll miss matches.
5. **5-match form column** on the Tables tab — uses API-Football standings' `form` field.

## What stays out (deferred to PR 2 / PR 3)

- Per-team squad, coach, team statistics — that's PR 2.
- Player ratings per match, lineups, events — that's PR 2.
- Live events with 30s refresh + dedicated `/match/[id]` enrichment — PR 3.
- A brand-new "Players" tab — PR 3.

## Caching strategy

All wrappers in `src/lib/api-football-data.ts` already pass `next.revalidate`
to fetch. We use:

| Endpoint | revalidate (s) | Why |
| --- | --- | --- |
| `/players/topscorers` | 3600 (1 hour) | Refreshes after each match |
| `/players/topassists` | 3600 | Same |
| `/players/topyellowcards` | 3600 | Same |
| `/injuries` | 3600 | Refreshes a few times per day max |
| `/standings` | 3600 | Refreshes after each match |

Worst-case daily API call cost for this PR: 5 endpoints × 24 hours × 1 origin
= **~120 calls/day** out of a 7500/day Pro budget.

## Files touched

- `src/lib/api-football-data.ts` — already has the wrappers. Verify revalidate values + add `fetchStandings` if not present.
- `src/lib/stats.ts` — point `getLiveTopScorers` at API-Football when key is set, fall back to football-data otherwise.
- `src/app/[lang]/tournament/SummaryTab.tsx` — render TopAssists + TopYellowCards cards alongside existing TopScorers.
- `src/app/[lang]/tournament/TablesTab.tsx` (and the underlying `LiveStandings.tsx`) — add a `form` column from API standings.
- `src/app/[lang]/dictionaries/{he,en}.json` — labels for the new sections.
- New: `InjuriesBanner.tsx` — collapsible card for the Summary tab.

## Empty-state policy

Every new component must render gracefully when API-Football returns `null`
(stubbed mode OR upstream error). Empty-state copy:
- Top assists: "טבלת המבשלים תופיע כשיהיו בישולים." / "Standings appear once assists are recorded."
- Top yellows: "טבלת הכרטיסים תופיע כשיהיו כרטיסים." / "Cards leaderboard appears once cards are issued."
- Injuries: hide the banner entirely if the list is empty. Don't show "no injuries" — too noisy.
- Form column: show "—" for teams with 0 played matches.

## Security

- No new client-side fetches; everything is SSR. API key never enters the bundle.
- No new mutations. Read-only.
- No new user input. No validation needed.

## Observability

Add `[wc-zone enrichment]` namespaced logs:
- `[wc-zone enrichment] top scorers fetched`, `{ count, source: "api-football" | "football-data" }`
- `[wc-zone enrichment] injuries fetched`, `{ count }`
- `[wc-zone enrichment] standings form available`, `{ groupsWithForm }`

Each helps post-launch debugging when a card mysteriously empty-states.

## Mobile (per project CLAUDE.md)

- New cards stack under `md`, same as existing.
- Tables stay scroll-free under 360px (the form column is 5 small dots, narrow).
- No new touch targets under 44px.

## Rollout

Single commit. Build verified locally. Push to master.
