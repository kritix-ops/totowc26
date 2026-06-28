# Live-bet suggestions: count-bug, inline LLM log, prompt editor, publish-from-edit

Date: 2026-06-28
Branch: `sandbox`
Status: approved (clarifying questions answered)

## Goal

Four changes to the admin live-bet suggestion flow, all driven by the user's
report. Everything the user asked to "see" must appear inline on
`/admin/live-bets/suggestions` — no bouncing to other pages.

1. Fix the mobile bug where the "how many suggestions" field snaps to 10.
2. Show a live, persistent log of every AI generation run on the same page:
   progress, errors, and exactly how many suggestions it produced.
3. Let the admin view the full prompt the LLM receives and edit a safe
   guidance block (separate for match scope and day scope).
4. In the live-bet edit form, add a Publish button and, after save/publish,
   return to the previous screen (the filtered bets list) instead of the
   detail page.

## Decisions (from the user)

- Prompt editing: SAFE guidance block appended to the system prompt + a
  read-only view of the full assembled prompt. Not a free-form overwrite of
  the whole system prompt (which could break the grading/schema contract).
- Prompt guidance is SEPARATE for match scope and day scope.
- The log and the prompt panel both live inline on the suggestions page.

## Root causes / current behavior

- Count bug: both `GenerateAiButton.tsx` and `GenerateDayAiButton.tsx` use a
  controlled `value={count}` with `onChange = parseInt(value || "6")`. Clearing
  the field snaps it back to 6 immediately, so on mobile the user can't blank
  it; typing a digit appends to the 6 ("63"/"36") which clamps to 10 via
  `Math.min(10, n)`.
- Logging: `generate.ts` logs rich diagnostics (`returned/valid/dropped/
  demotedToManual/usage/searchRequests`) to the SERVER console only. The
  generation runs in the background via `after()` and the admin only gets a
  push/in-app notification. None of it is visible in the UI.
- Prompt: built in code by `buildSystemPrompt`/`buildUserPrompt` in
  `src/lib/bets/suggest/prompt.ts`. Not visible or editable in the admin.
- Edit/publish: `BetForm.finish()` flushes the draft autosave and navigates to
  the bet DETAIL page (`/admin/bets/[id]`). There is no publish action in the
  form; the admin has to go back to the list and find the bet to publish it.
  The edit page already computes a sanitized `return` filter query but does
  not pass it into `BetForm`.

## Approach

### 1. Count input fix
- New pure helper `src/lib/bets/suggest/count.ts`:
  `clampSuggestionCount(text: string): number` → parse, clamp 2..10, fallback 6.
- Both buttons switch to a raw-string state `countText` + derived
  `count = clampSuggestionCount(countText)`. Input becomes
  `type="text" inputMode="numeric"`, `onChange` strips non-digits (max 2),
  `onBlur` normalizes back to `String(count)`. The button label and the action
  call use the derived `count`. Lets the field be momentarily empty (no
  snap-back), kills the iOS number-input quirk.

### 2. Inline live generation log
- New table `live_gen_runs` (migration `0069`, also added to `schema.ts` as
  `liveGenRuns`): id, scope, subject_he, model, requested, status
  (running/done/failed), returned, valid, created, failed, search_requests,
  input_tokens, output_tokens, error, started_by, started_at, finished_at.
  RLS: admin read (`public.is_admin()`), writes via service-role pool (mirrors
  `0067_bet_odds_audit`). REVOKE update/delete from client roles.
- `generate.ts`: extend `GenerateResult` with a `stats` field
  (`returned/valid/dropped/demotedToManual/searchRequests/inputTokens/
  outputTokens`) on both ok and error paths so the caller can persist it
  (single source of truth — no re-deriving in the action).
- `actions.ts`: `generateAiSuggestions`/`generateDaySuggestions` insert a
  `running` run row synchronously (so the page shows it immediately), pass the
  run id into the background task, which finalizes the row with model + counts
  + status (+ error). The crash/`catch` paths mark it `failed`.
- New server action `listRecentGenRuns(limit = 12)`.
- New client component `GenerationLog.tsx`: seeded with initial runs from the
  server page, polls `listRecentGenRuns` every ~5s (lighter cadence once no
  row is running). Each row: status pill, scope + subject, model, "ביקשת X →
  תקינות Y → נוצרו Z (W נכשלו)", search count, tokens, error, relative time.
  Rendered near the top of the suggestions page.

### 3. Prompt viewer + guidance editor
- Two nullable settings columns (migration `0069`, same file): `suggest_guidance_match`,
  `suggest_guidance_day`. Added to `schema.ts`.
- `prompt.ts`: `buildSystemPrompt(scope, guidance?)` appends a fenced "House
  guidance from the pool admin (apply within ALL the hard rules above; never
  override format/schema/grading/bilingual)" block, capped at 2000 chars.
- `generate.ts`: add `guidance` to `GenerateOptions`, pass to
  `buildSystemPrompt`.
- `actions.ts`: read `suggest_guidance_match`/`_day` from settings and pass the
  scope-matching one as `guidance`.
- New server actions: `getPromptInfo()` (returns, per scope, the full rendered
  system prompt with current guidance, a sample user-prompt skeleton, and the
  current guidance text) and `setSuggestGuidance(scope, text)`.
- New client component `PromptEditor.tsx`: match/day toggle, a collapsible
  read-only view of the full assembled prompt (monospace, scrollable, copy
  button), an editable guidance textarea with save + status, and a note that
  guidance cannot override the hard rules.

### 4. Publish-from-edit + return-to-list
- `BetForm` gains a `returnQs?: string` prop; the edit page passes its
  sanitized `return` query in. `listHref = admin/bets[?<returnQs>]`.
- Edit mode: `finish()` (Save & close) navigates to `listHref`; a new Publish
  PillButton flushes the autosave, awaits `publishCustomBet(id)`, then
  navigates to `listHref`. Publish is the primary button; Save & close is
  secondary; Back stays. Create mode keeps its current behavior.

## Alternatives rejected

- Full free-form system-prompt override (rejected by the user): real risk of
  breaking the grading-source/schema/bilingual contract and silently wrecking
  generation or auto-grading.
- Log only via richer notification text: ephemeral, not inspectable, fails the
  "see it on the spot on the page" requirement.
- Synchronous generation to return diagnostics in place: generation takes up to
  ~2 min and is intentionally backgrounded; can't block the response.

## Security (rule 13)
- All new server actions gate on `getUser()` + `hasPermission(id, "liveBets")`.
- Guidance is admin-only, fenced in the prompt, length-capped; it can only
  steer wording/selection, never bypass the downstream schema validation.
- `live_gen_runs` RLS: admin read only; client roles cannot update/delete.
- No secrets/PII logged; error text stored is the tagged error code/short body.

## Observability (rule 14)
- `live_gen_runs` IS the user-facing observability surface for generation.
- Keep all existing `[live-gen ...]` console logs; add `[live-gen run]` insert/
  finalize logs and `[suggest-guidance set]`.

## Testing (rule 18)
- `count.test.ts`: clamp/parse/empty/overflow/non-numeric.
- `prompt.test.ts`: guidance appended when present, unchanged when absent,
  truncated past the cap.
- `generate.test.ts`: extend for the new `stats` shape on ok + error.
- Run `pnpm test` (vitest) for the whole suite.

## Deploy (rule 19)
- Work stays on `sandbox`. No push/merge without explicit go-ahead.
- Migration `0069` applies on Vercel prebuild (`maybe-migrate.mjs`); locally run
  `pnpm db:migrate` only against a dev DB, never prod, and only if asked.

## Out of scope / not exposed
- No new user-facing setting beyond the guidance text and the (existing) model
  picker. The count default stays 6 (not surfaced as a setting).
