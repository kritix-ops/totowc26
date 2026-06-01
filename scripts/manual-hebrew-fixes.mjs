#!/usr/bin/env node
// Hand-edited Hebrew name corrections for players whose LLM-reviewed
// transliteration deviates from Israeli sports-media convention. Sets
// name_he_admin_locked = true on each row so the translation pipeline
// never overwrites them.
//
// Usage:
//   node --env-file=.env.local scripts/manual-hebrew-fixes.mjs
import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) { console.error("DIRECT_URL missing"); process.exit(1); }

// (api_football_id, name_he, why)
const FIXES = [
  [19586,  "אברצ'י אזה",      "Eberechi Eze — sports media uses gershayim for the 'ch' sound"],
  [19366,  "אולי ווטקינס",    "Ollie Watkins — single yod, not double, matches Hebrew Ollie pronunciation"],
  [19545,  "ריס ג'יימס",      "Reece James — final samekh (ס), not zayin (ז), per standard transliteration"],
  [158694, "טינו ליברמנטו",   "Tino Livramento — squad name is Tino, not Valentino, per Tuchel's announcement"],
];

const sql = postgres(url, { max: 1, prepare: false });
try {
  for (const [id, nameHe, why] of FIXES) {
    const before = (await sql`select name_en, name_he from public.players where api_football_id = ${id}`)[0];
    if (!before) { console.log(`  ! ${id} not in DB`); continue; }
    await sql`
      update public.players
      set name_he = ${nameHe},
          name_he_source = 'manual',
          name_he_review_verdict = 'approved',
          name_he_review_reason = ${why},
          name_he_reviewed_at = now(),
          name_he_admin_locked = true,
          updated_at = now()
      where api_football_id = ${id}
    `;
    console.log(`  ✓ ${String(id).padEnd(7)}  ${before.name_en.padEnd(20)}  ${before.name_he}  →  ${nameHe}`);
  }
} finally {
  await sql.end();
}
