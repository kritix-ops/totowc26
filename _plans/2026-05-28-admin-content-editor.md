# Admin content editor — edit every user-facing string from the admin panel

Status: approved 2026-05-28. Scope locked. Executing autonomously per
`feedback_autonomous_in_session`.

## Goal

Give the admin (Yoav) a single screen in `/admin/content` where he can
edit every Hebrew or English string the app shows to users, without
filing a code-change request. After Save, the change is live for every
user within seconds.

## Why now

The Hebrew-language QA pass on 2026-05-28 surfaced ~115 fixes across 55
files. Most of them were one-line copy edits that should never have
needed an engineer. Going forward we cut Claude out of that loop. Yoav
edits copy himself, in production, in either language, and the change
ships immediately.

## Non-goals

- Not a general CMS. No rich text, images, layouts, blocks, page
  composition. Plain strings only.
- Not user-contributed content. Admin-only.
- Not multi-tenant. One admin role, one site.
- Not version history yet. We log who/when/old/new server-side, but no
  UI surface for diff/rollback this pass.

## Constraints

- **Vercel hosting**: filesystem is read-only after build. JSON files
  on disk cannot be edited at runtime. Storage MUST be Postgres.
- **Bilingual**: every editable string has a Hebrew value and an English
  value. Either can be empty (fall back to default).
- **Source of truth for defaults**: `src/app/[lang]/dictionaries/he.json`
  and `en.json` stay in git. DB only holds overrides on top of those
  defaults. This keeps copy reviewable in PRs by default and lets us
  ship copy changes through either path (commit OR admin edit).
- **Performance**: dictionary is read on every server-rendered page. The
  override layer must not add latency. Cache aggressively with
  `unstable_cache` + a single tag, invalidated on save.
- **Interpolation slots stay intact**: keys like `{stake}`, `{max}`,
  `{n}`, `{startingBank}` must survive admin edits. The editor renders
  them as chips that cannot be deleted by accident.

## Approach (chosen)

### Storage

New table `content_overrides`:

```
key         text not null     -- "rules.bankBody", "duels.title", etc.
locale      text not null     -- 'he' | 'en'
value       text not null     -- the override
updated_at  timestamptz default now()
updated_by  uuid              -- profiles.id of the admin who saved
primary key (key, locale)
```

Plus an `content_override_history` audit table that records every save
(`key, locale, old_value, new_value, updated_at, updated_by`) so we
have an answer when "who changed the copy on the rules page" comes up.

### Dictionary loader

`src/app/[lang]/dictionaries.ts` already exposes `getDictionary(locale)`
that imports the JSON. I extend it to:

1. Load the JSON default (as today).
2. Load all overrides for that locale from `content_overrides`,
   wrapped in `unstable_cache` with tag `content-overrides`.
3. Deep-merge overrides on top of the default and return.

Cache invalidation: server action calls `revalidateTag("content-overrides")`
after every save. Next.js push updates to all server renders within a
few seconds.

### Editor UI

Route: `/admin/content`. One screen, mobile-first per the project rule.

- Top: search box (filters across keys and values, both languages).
- Below: sections as collapsible groups (mirrors the JSON top-level
  keys — `common`, `nav`, `landing`, `onboarding`, `bank`, etc.).
- Each row: key on the left, Hebrew input, English input. Shows a small
  badge "Overridden" when the row differs from the JSON default; a
  "Reset to default" link clears the override.
- Interpolation chips: when a default contains `{stake}` etc., the
  editor renders them as non-editable chips inside the textarea preview
  AND validates on save that every chip in the default also appears in
  the override. Save rejects with a clear error if a chip is missing.
- Save: per-row save (lower friction, no risk of losing other edits).
  No bulk save in v1.
- Mobile: each row becomes a stacked card under `md` per the project
  responsive rule. Inputs are 48px tall.

### Migration of hardcoded strings (the heavy lift)

Today ~117 files contain hardcoded strings (`isHebrew ? "X" : "Y"` and
similar). For the admin to edit them, they must live in the
dictionary. Approach:

1. Sub-agent scans each file, collects every hardcoded HE/EN pair.
2. Generates a key under a new `hardcoded.<filename>.<index>` namespace
   so we don't pollute the curated sections (`common`, `nav`, etc.).
3. Replaces the source with `dict.hardcoded.<key>` (or local `t.key`
   if the file already has a `t = dict.<section>` binding).
4. Appends the pair to `he.json` and `en.json`.

Run as four parallel sub-agents (same partition as the Hebrew QA pass:
public pages, admin pages, components/emails/libs, plus one for the
dictionary/loader infra). Validation gate at the end: `tsc --noEmit`
and `npm run lint`, must pass.

This is the slowest phase. Ship Phase 1 (editor + JSON keys only)
first, so Yoav can edit the 858 JSON keys immediately while the
migration of hardcoded strings happens in Phase 2 over the following
day.

## Alternatives rejected

- **Edit JSON files on disk**: impossible on Vercel. Filesystem is
  read-only after build.
- **Move dictionary entirely to DB, drop JSON**: loses git history of
  copy, makes local dev / preview branches harder (need DB snapshot
  for English copy to render), removes the "ship copy via PR" path.
- **In-page WYSIWYG (click any text to edit)**: 5-10x the work, needs
  client-side instrumentation on every render, brittle. Section-based
  editor delivers the same outcome with a fraction of the code.
- **Cron-based revalidation (eventual consistency)**: user picked
  "instant", so revalidateTag is the right call.

## Security

- Admin-only via `requireAdmin(locale)` on both the page and the server
  action.
- Server action validates: `key` exists in the default dictionary
  (no arbitrary key writes), `locale` is `he` or `en`, `value` is a
  string under 4000 chars, every `{slot}` in the default also appears
  in the new value (so a save can't break interpolation).
- All writes go through the server action, never directly from the
  client. Drizzle's parameterised queries prevent SQL injection.
- History row writes `updated_by = user.id` so we always know who.
- No PII logged in the override values themselves (we trust the admin
  not to paste secrets into copy — call this out in the UI hint).
- Rate limit: not v1 priority — admin is one trusted person.

## Observability

Follow CLAUDE.md rule 14. Every step gets a namespaced log:

Server action:
- `[admin content save] start { key, locale, byUser, valueLen }`
- `[admin content save] validation_failed { key, reason }`
- `[admin content save] db_written { key, locale, rowCount }`
- `[admin content save] revalidated { tag: "content-overrides" }`
- `[admin content save] done { key, locale, durationMs }`

Loader:
- `[dict load] cache_miss { locale }` (only on cold cache)
- `[dict load] overrides_applied { locale, count }`

Browser:
- `console.info('[admin content ui] save_click', { key, locale })`
- `console.info('[admin content ui] save_ok', { key, locale })`
- `console.warn('[admin content ui] save_failed', { key, error })`

## Settings audit (CLAUDE.md rule 15)

The content editor IS the settings layer for copy. New controls:
- A "Reset to default" link per row (clears the override).
- A top-level "Show only overridden" toggle so the admin can see at a
  glance what diverges from the shipped JSON.
- A "Show interpolation chips" hint that defaults on; off-mode shows
  the raw `{slot}` for users who prefer it.

Nothing else gets hardcoded in this feature. No font, color, or layout
choices to expose — pure copy.

## Phasing

**Phase 1 — editor for JSON keys** (today):
1. Drizzle schema + migration for `content_overrides` and
   `content_override_history`.
2. Extend `getDictionary` with override layer + caching.
3. `/admin/content` page with section groups, search, per-row save.
4. Server action with auth, validation, history, revalidateTag.
5. Logs on both sides.
6. Admin nav tile.
7. `tsc` + `lint` pass.

**Phase 2 — migrate hardcoded strings** (after Phase 1 ships):
8. Four parallel sub-agents extract hardcoded HE/EN pairs into
   `he.json`/`en.json` under a `hardcoded.*` namespace and update call
   sites to read from the dictionary.
9. Revalidation pass: `tsc`, `lint`, manual smoke test of the affected
   screens.

## Open questions (will not block Phase 1)

- Do we want a soft launch on a feature flag, or just ship? Default:
  just ship (one admin, low blast radius, easy to revert with a DB
  delete).
- Do we want a "Restore from history" UI? Default: no in v1, but the
  audit table makes it a one-day add later.
