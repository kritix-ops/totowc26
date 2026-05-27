#!/usr/bin/env node
// Two-phase Hebrew translation pipeline for public.players.
//
//   Phase A — Transliteration. For every row where name_he is NULL
//             and name_he_admin_locked = false, ask Claude to
//             transliterate the player's English name using Israeli
//             sports-media conventions ("מסי" not "מסשי", "מבאפה"
//             not "מבאפי"). Writes name_he, source='llm_claude',
//             confidence (Claude's self-reported 0-100).
//
//   Phase B — LLM-expert review. For every row with name_he but no
//             review verdict (and not admin-locked), send Claude
//             the metadata + the current Hebrew name and ask
//             whether Israeli sports media would write it that way.
//             Verdict ∈ {approved, flag, reject}. If the reviewer
//             proposes a different name and verdict ∈ {flag,
//             reject}, the proposed name overwrites name_he and
//             source flips to 'llm_reviewer'.
//
// Idempotent:
//   - Phase A only touches rows with name_he IS NULL.
//   - Phase B only touches rows with review_verdict IS NULL.
//   - admin_locked rows are NEVER touched by either phase.
//   - Pass `--force-retranslate` to redo phase A on rows that
//     have a non-locked name_he (e.g. after a model upgrade).
//
// Cost note (rule 8 in CLAUDE.md):
//   Haiku 4.5 default for both phases. ~1,200 players × ~100
//   tokens prompt + ~50 tokens output = ~180K tokens. At Haiku
//   pricing the full run is well under $1. Sonnet override is
//   available via env (CLAUDE_MODEL_TRANSLATE / CLAUDE_MODEL_REVIEW).
//
// Usage:
//   node --env-file=.env.local scripts/translate-players.mjs
//     [--phase=translate|review|both]   (default: both)
//     [--batch-size=20]
//     [--force-retranslate]
//     [--dry-run]
//
// Required env:
//   DIRECT_URL          - Supabase direct connection string
//   ANTHROPIC_API_KEY   - api.anthropic.com key

import postgres from "postgres";

// ─── CLI flag parsing ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  for (const a of argv) {
    if (a === `--${name}`) return true;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
};
const phase            = flag("phase", "both"); // 'translate' | 'review' | 'both'
const batchSize        = Number(flag("batch-size", 20));
const forceRetranslate = flag("force-retranslate", false) === true;
const dryRun           = flag("dry-run", false) === true;

if (!["translate", "review", "both"].includes(phase)) {
  console.error(`Invalid --phase: ${phase}. Must be one of translate|review|both.`);
  process.exit(1);
}

// ─── Env ───────────────────────────────────────────────────────────────
const url = process.env.DIRECT_URL;
const apiKey = process.env.ANTHROPIC_API_KEY;
const TRANSLATE_MODEL = process.env.CLAUDE_MODEL_TRANSLATE ?? "claude-haiku-4-5-20251001";
const REVIEW_MODEL    = process.env.CLAUDE_MODEL_REVIEW    ?? "claude-haiku-4-5-20251001";

if (!url) {
  console.error("DIRECT_URL is not set. Run with: node --env-file=.env.local scripts/translate-players.mjs");
  process.exit(1);
}
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local before running.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

// ─── Claude API helper ─────────────────────────────────────────────────
//
// One call to api.anthropic.com/v1/messages, with structured JSON output
// enforced by a tools block. Returns the parsed tool_use arg or throws.
async function claudeJson({ model, system, user, schema, schemaName, maxTokens = 1500 }) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    tools: [
      {
        name: schemaName,
        description: `Return the data using the ${schemaName} schema.`,
        input_schema: schema,
      },
    ],
    tool_choice: { type: "tool", name: schemaName },
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 400)}`);
  }
  const json = await res.json();
  // The model is forced into a tool_use call; extract its input.
  const block = (json.content ?? []).find((b) => b.type === "tool_use");
  if (!block) throw new Error(`Anthropic response had no tool_use block: ${JSON.stringify(json).slice(0, 400)}`);
  return block.input;
}

// ─── Phase A: translation ──────────────────────────────────────────────
const TRANSLATE_SYSTEM = `You are an Israeli sports-media editor.
For each player given, return how Israeli sports media (Walla, Sport5, One, YNET) would normally write their name in Hebrew.
Follow standard Israeli media transliteration conventions for names:
  - prefer the form used in Hebrew sports articles, not literal letter-for-letter transliteration
  - drop English suffixes like Jr., Junior, Filho only if Israeli media drops them too
  - for famous players use their established Hebrew form (Messi → מסי, Mbappé → מבאפה, Ronaldo → רונאלדו)
  - if you genuinely don't know how Israeli media writes a name, transliterate phonetically and lower the confidence
Return one entry per input id with confidence 0-100.`;

const TRANSLATE_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:         { type: "integer", description: "player api_football_id from the input" },
          name_he:    { type: "string", description: "Hebrew name as Israeli media would write it" },
          confidence: { type: "integer", description: "0-100, your confidence in this transliteration" },
        },
        required: ["id", "name_he", "confidence"],
      },
    },
  },
  required: ["translations"],
};

async function translateBatch(rows) {
  const lines = rows.map((r, i) =>
    `${i + 1}. id=${r.apiFootballId} | ${r.nameEn} | team ${r.teamNameEn} | position ${r.position ?? "—"}`,
  ).join("\n");
  const user = `Translate these players to Hebrew:\n\n${lines}`;
  const out = await claudeJson({
    model:      TRANSLATE_MODEL,
    system:     TRANSLATE_SYSTEM,
    user,
    schema:     TRANSLATE_SCHEMA,
    schemaName: "save_translations",
    maxTokens:  Math.max(1500, rows.length * 80),
  });
  return out.translations ?? [];
}

async function runTranslatePhase() {
  const candidates = forceRetranslate
    ? await sql`
        select p.api_football_id, p.name_en, t.name_en as team_name_en, p.position
        from public.players p
        join public.teams   t on t.code = p.team_code
        where p.name_he_admin_locked = false
        order by p.team_code asc, p.jersey_number nulls last, p.name_en asc
      `
    : await sql`
        select p.api_football_id, p.name_en, t.name_en as team_name_en, p.position
        from public.players p
        join public.teams   t on t.code = p.team_code
        where p.name_he is null
          and p.name_he_admin_locked = false
        order by p.team_code asc, p.jersey_number nulls last, p.name_en asc
      `;
  console.log(`Phase A — translation: ${candidates.length} candidate rows.`);
  if (candidates.length === 0) return { translated: 0, errors: 0 };

  let translated = 0;
  let errors = 0;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize).map((r) => ({
      apiFootballId: r.api_football_id,
      nameEn:        r.name_en,
      teamNameEn:    r.team_name_en,
      position:      r.position,
    }));
    process.stdout.write(`  batch ${Math.floor(i / batchSize) + 1} (${batch.length} rows)… `);
    try {
      const out = await translateBatch(batch);
      for (const row of out) {
        if (!row?.id || !row?.name_he) continue;
        const confidence = Math.max(0, Math.min(100, Number(row.confidence) || 50));
        if (dryRun) {
          console.log(`\n    [dry-run] ${row.id} → "${row.name_he}" (${confidence}%)`);
        } else {
          await sql`
            update public.players
            set name_he            = ${row.name_he},
                name_he_source     = 'llm_claude',
                name_he_confidence = ${confidence},
                updated_at         = now()
            where api_football_id = ${row.id}
              and name_he_admin_locked = false
          `;
        }
        translated += 1;
      }
      process.stdout.write(`${out.length} ok\n`);
    } catch (err) {
      errors += 1;
      process.stdout.write(`FAILED: ${err.message}\n`);
    }
  }
  return { translated, errors };
}

// ─── Phase B: LLM-expert review ────────────────────────────────────────
const REVIEW_SYSTEM = `You are an Israeli sports-media editor reviewing player-name translations.
For each row, you receive: player's English name, team, position, and a proposed Hebrew name.
Decide whether the proposed Hebrew name is how Israeli sports media (Walla, Sport5, One, YNET) would write that player's name.

Return one of:
  - "approved" — the proposed name matches Israeli sports-media style
  - "flag"     — likely usable but has minor issues (vowel choice, suffix); include suggestion + brief reason
  - "reject"   — wrong enough that the row should be redone; suggestion required, brief reason required
Be strict on famous players (Messi, Ronaldo, Mbappé, Haaland) and tolerant of acceptable variants for bench players.`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:         { type: "integer", description: "player api_football_id from the input" },
          verdict:    { type: "string", enum: ["approved", "flag", "reject"] },
          suggestion: { type: "string", description: "your proposed Hebrew name; required when verdict is 'flag' or 'reject', optional when 'approved'" },
          reason:     { type: "string", description: "brief explanation in Hebrew, max 80 chars" },
        },
        required: ["id", "verdict", "reason"],
      },
    },
  },
  required: ["reviews"],
};

async function reviewBatch(rows) {
  const lines = rows.map((r, i) =>
    `${i + 1}. id=${r.apiFootballId} | ${r.nameEn} (${r.teamNameEn}, ${r.position ?? "—"}) | proposed: ${r.nameHe}`,
  ).join("\n");
  const user = `Review these proposed Hebrew names:\n\n${lines}`;
  const out = await claudeJson({
    model:      REVIEW_MODEL,
    system:     REVIEW_SYSTEM,
    user,
    schema:     REVIEW_SCHEMA,
    schemaName: "save_reviews",
    maxTokens:  Math.max(2000, rows.length * 120),
  });
  return out.reviews ?? [];
}

async function runReviewPhase() {
  const candidates = await sql`
    select p.api_football_id, p.name_en, t.name_en as team_name_en, p.position, p.name_he
    from public.players p
    join public.teams   t on t.code = p.team_code
    where p.name_he is not null
      and p.name_he_review_verdict is null
      and p.name_he_admin_locked = false
    order by p.team_code asc, p.jersey_number nulls last, p.name_en asc
  `;
  console.log(`Phase B — review: ${candidates.length} candidate rows.`);
  if (candidates.length === 0) return { reviewed: 0, errors: 0 };

  let reviewed = 0;
  let errors = 0;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize).map((r) => ({
      apiFootballId: r.api_football_id,
      nameEn:        r.name_en,
      teamNameEn:    r.team_name_en,
      position:      r.position,
      nameHe:        r.name_he,
    }));
    process.stdout.write(`  batch ${Math.floor(i / batchSize) + 1} (${batch.length} rows)… `);
    try {
      const out = await reviewBatch(batch);
      for (const row of out) {
        if (!row?.id || !row?.verdict) continue;
        const verdict = row.verdict;
        const reason = String(row.reason ?? "").slice(0, 200);
        const suggestion = row.suggestion ? String(row.suggestion).trim() : null;

        // Did the reviewer want a different name?
        // Only overwrite when verdict says the current name is wrong.
        const shouldRewrite =
          suggestion && (verdict === "reject" || verdict === "flag");
        if (dryRun) {
          console.log(`\n    [dry-run] ${row.id} → ${verdict}${suggestion ? ` (suggest: ${suggestion})` : ""} — ${reason}`);
        } else if (shouldRewrite) {
          await sql`
            update public.players
            set name_he                  = ${suggestion},
                name_he_source           = 'llm_reviewer',
                name_he_review_verdict   = ${verdict},
                name_he_review_reason    = ${reason},
                name_he_reviewed_at      = now(),
                updated_at               = now()
            where api_football_id = ${row.id}
              and name_he_admin_locked = false
          `;
        } else {
          await sql`
            update public.players
            set name_he_review_verdict = ${verdict},
                name_he_review_reason  = ${reason},
                name_he_reviewed_at    = now(),
                updated_at             = now()
            where api_football_id = ${row.id}
              and name_he_admin_locked = false
          `;
        }
        reviewed += 1;
      }
      process.stdout.write(`${out.length} ok\n`);
    } catch (err) {
      errors += 1;
      process.stdout.write(`FAILED: ${err.message}\n`);
    }
  }
  return { reviewed, errors };
}

// ─── Main ──────────────────────────────────────────────────────────────
try {
  console.log(`translate-players.mjs starting`);
  console.log(`  phase=${phase}, batchSize=${batchSize}, forceRetranslate=${forceRetranslate}, dryRun=${dryRun}`);
  console.log(`  translate model: ${TRANSLATE_MODEL}`);
  console.log(`  review model:    ${REVIEW_MODEL}\n`);

  let translateResult = null;
  let reviewResult = null;
  if (phase === "translate" || phase === "both") {
    translateResult = await runTranslatePhase();
    console.log();
  }
  if (phase === "review" || phase === "both") {
    reviewResult = await runReviewPhase();
    console.log();
  }

  console.log("Summary:");
  if (translateResult) {
    console.log(`  Translation: ${translateResult.translated} rows updated, ${translateResult.errors} batch errors.`);
  }
  if (reviewResult) {
    console.log(`  Review:      ${reviewResult.reviewed} rows reviewed, ${reviewResult.errors} batch errors.`);
  }
  if (dryRun) {
    console.log(`  (dry-run — no DB writes performed.)`);
  }
} finally {
  await sql.end();
}
