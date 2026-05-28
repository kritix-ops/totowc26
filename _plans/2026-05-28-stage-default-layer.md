# Per-stage lock-offset default + /admin/deadlines clarity rewrite

**Date:** 2026-05-28
**Author:** Claude
**Status:** approved (in conversation), implementing

## Goal

Two things on `/admin/deadlines`:

1. The "ברירות מחדל לפי סוג הימור" card is unclear — the 5 custom bet types
   all share the prefix "הימור מותאם —", which buries the differentiator, and
   the concrete example sits in 11px footnote text. The admin can't tell at
   a glance what each row controls.
2. The admin has no way to set "all R16 matchdays lock 90 min before
   kickoff" in one shot — they have to walk the per-matchday list and set
   each row individually. They want a real **default for a whole stage**.

## Constraints

- Six bet types stay (no schema change to `bet_lock_defaults`).
- New layer must behave like a real default: empty matchday override falls
  through to the stage default automatically; future matchdays added later
  inherit without re-clicking.
- Same set of bet types as the existing matchday override:
  `match_score`, `custom_match`, `custom_day`. The other three bet types
  (`custom_stage`, `custom_group`, `custom_tournament`) already have
  scope-specific anchors and per-type offsets — adding per-stage on top is
  feature creep and out of scope.
- Mobile-first (per project CLAUDE.md). Single column under `md`.
- Asia/Jerusalem timezone for any user-facing date.
- Logging at every meaningful step (per global rule 14).

## Resolution chain

Before:
```
match.lock_at_override
  → settings.match_picks_global_lock_at   (1/X/2 only)
  → matchdays.lock_offset_override_minutes
  → bet_lock_defaults[bet_type]
```

After (one new layer):
```
match.lock_at_override
  → settings.match_picks_global_lock_at   (1/X/2 only)
  → matchdays.lock_offset_override_minutes
  → stage_lock_defaults[stage]            ← NEW
  → bet_lock_defaults[bet_type]
```

Stage lookup per bet type:
- `match_score`, `custom_match` → `match.stage`
- `custom_day` → stage of the earliest-kickoff match on that matchday
  (the same anchor we already use for the matchday's earliest-kickoff
  display). If a matchday has no matches yet, fall through to type default.

## Schema

New table `stage_lock_defaults`:

```sql
CREATE TABLE stage_lock_defaults (
  stage stage PRIMARY KEY,
  offset_minutes integer NOT NULL CHECK (offset_minutes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);
```

Seeded with no rows — an empty table means "no per-stage override, every
matchday inherits the type default". Admin opts into a stage by saving a
value.

## API changes

`DeadlineContext` gains:
```ts
stageDefaults: Partial<Record<StageKey, number>>;
```
Empty object when the table is empty.

`MatchScoreResolveInput` gains `stage: StageKey`. Both production callers
(`bets/[matchId]/page.tsx`, `bets/[matchId]/actions.ts`) already have
`match.stage` in scope — straight pass-through.

`PreviewInput` gains an optional `stage?: StageKey` for `match`/`day`
scopes. Admin BetForm calculates the stage from the chosen match
(scope=match) or earliest match on the day (scope=day).

## UI

### TypeDefaultsCard (rewrite, no schema change)

Two sub-blocks:

**ניחוש תוצאה (1/X/2)** — one row.
- Label: ניחוש תוצאה (1/X/2)
- Example: "מי תנצח: ארגנטינה, איטליה או תיקו?"
- Anchor: "בעיטת הפתיחה של המשחק"

**הימורים מותאמים** — sub-heading + 5 rows.
- משחק — "למשל: מי יבקיע את הגול הראשון?" — בעיטת הפתיחה
- יום — "למשל: כמה גולים בסך הכל היום?" — המשחק הראשון של היום
- בית — "למשל: מי תעלה ראשונה מבית A?" — המשחק הראשון בבית
- שלב — "למשל: כמה כרטיסים אדומים בשלב הבתים?" — המשחק הראשון בשלב
- כל הטורניר — "למשל: מי תזכה במונדיאל?" — תאריך תחילת הטורניר

Order: matches what the admin sees in `/admin/bets` (משחק / יום / שלב /
בית / טורניר) BUT swap בית and שלב per user pick: narrowest → widest:
משחק → יום → בית → שלב → טורניר.

Display order in the BET_TYPE_KEYS array stays untouched (DB-facing); the
form drives its rendering from a UI-specific order array.

### NEW: StageDefaultsCard

Between TypeDefaultsCard and MatchdayOverridesCard. One row per stage
(group / r32 / r16 / qf / sf / third_place / final). Each row: stage
label + number input (placeholder = type default of the bet types it
affects) + "דק' לפני". Empty value clears the row.

Copy:
- Title: "ברירות מחדל לפי שלב בטורניר"
- Intro: "ערך כאן דורס את ברירת המחדל לסוג עבור משחקים, ימי הימורים
  והימורים מותאמים שמתרחשים בשלב הזה. ריק = נופל חזרה לברירת המחדל."

### MatchdayOverridesCard placeholder

Today: placeholder = `typeDefaults.custom_day`.
After: placeholder = `stageDefaults[matchday.stage] ?? typeDefaults.custom_day`,
plus a small caption "ברירת מחדל לשלב: 90" when a stage override exists,
so the admin sees the inherited value without having to mental-math it.

This also requires the loader to return `matchday.stage` (derived from
the earliest match on that date — null when the matchday has no matches
yet).

## Server actions

New `saveStageDefaults(rows: Array<{ stage: StageKey; offsetMinutes: number | null }>)`.
- `null` clears that stage's row (DELETE WHERE stage = ?).
- Number value upserts.
- Validates stage against the enum, offsetMinutes in `[0, 14 * 24 * 60]`
  (same bounds as matchday override).
- Logs the diff in `[admin deadlines stage-defaults]`.
- `revalidatePath("/", "layout")` to flush downstream pages that read
  the deadline context.

## Logs

- `[deadline context load]` already exists; extend payload with
  `stageDefaults`.
- `[deadline resolve]` already exists; `source` gains `"stage_default"`
  variant.
- `[admin deadlines stage-defaults]` — new log per save with full diff.

## Tests

`src/lib/deadlines.test.ts`:
- `resolveMatchScoreLock`:
  - stage default is used when matchday override is null
  - stage default is ignored when matchday override is set
  - stage default is ignored when global cap is set
  - stage default is ignored when per-bet override is set
- `previewCustomBetLock`:
  - match scope uses stage default when matchday offset is null
  - day scope uses stage default when matchday offset is null
  - stage default is ignored for scope='stage'/'group'/'tournament'

## Migration safety

Empty seed = zero behavior change for existing players. Resolver falls
through to the type default exactly as today until an admin saves a
stage value.

## Out of scope

- Per-stage defaults for `custom_stage` / `custom_group` /
  `custom_tournament` bets.
- Backfilling existing `custom_bets.lock_at` to honour new stage
  defaults (admin already has the "use defaults" workflow per bet).
- Bulk-apply UI for `match.lock_at_override` (would need its own
  product decision — out of scope for this change).

## Rollout

1. Land schema + migration.
2. Land resolver + tests.
3. Land actions + UI.
4. Manual QA on `/admin/deadlines` at 360/414/768/1024/1440 widths.
5. Manual QA on `/[lang]/bets/[matchId]` to confirm the stage default
   surfaces in the displayed lock time.
