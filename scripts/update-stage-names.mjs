#!/usr/bin/env node
// After patch-squads-from-final ran, pass-1 matches (where the DB already
// had the player) kept their old long birth-certificate names. The
// outright-odds ingester keys on the squad-poster / Wikipedia name, so
// it can't find "Pedri" → "Pedro González López". This script updates
// name_en to the canonical stage name for the known stars, keeping
// name_he intact (the Hebrew is already correct).
//
// Usage:
//   node --env-file=.env.local scripts/update-stage-names.mjs --dry-run
//   node --env-file=.env.local scripts/update-stage-names.mjs --apply
import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) { console.error("DIRECT_URL missing"); process.exit(1); }
const isDry = process.argv.includes("--dry-run");
const isApply = process.argv.includes("--apply");
if (!isDry && !isApply) { console.error("pass --dry-run or --apply"); process.exit(1); }

// (api_football_id, stage_name)
const STAGE_NAMES = [
  // Brazil
  [747,    "Casemiro"],
  [299,    "Fabinho"],
  [276,    "Neymar"],
  [762,    "Vinícius Júnior"],
  [1496,   "Raphinha"],
  [257,    "Marquinhos"],
  [30497,  "Bremer"],
  [30424,  "Ibanez"],
  [10124,  "Léo Pereira"],
  [10135,  "Bruno Guimarães"],
  [196156, "Igor Thiago"],
  [265785, "Luiz Henrique"],
  [275170, "Danilo Santos"],
  [407806, "Rayan"],
  [22224,  "Gabriel Magalhães"],
  [127769, "Gabriel Martinelli"],
  [1646,   "Lucas Paquetá"],
  [349001, "Wesley"],
  [24866,  "Douglas Santos"],
  // Portugal
  [128384, "Vitinha"],
  [925,    "Gonçalo Guedes"],
  [41585,  "Gonçalo Ramos"],
  [265595, "Gonçalo Inácio"],
  [161585, "Francisco Conceição"],
  [41112,  "Francisco Trincão"],
  [583,    "João Félix"],
  [855,    "João Cancelo"],
  [335051, "João Neves"],
  [886,    "Diogo Dalot"],
  [263482, "Nuno Mendes"],
  [41621,  "Matheus Nunes"],
  [336671, "Renato Veiga"],
  [2676,   "Rúben Neves"],
  [46672,  "Rui Silva"],
  [190485, "Samu Costa"],
  [161939, "Tomás Araújo"],
  [1864,   "Pedro Neto"],
  [1590,   "José Sá"],
  // Spain
  [133609, "Pedri"],
  [1323,   "Dani Olmo"],
  [47519,  "Pedro Porro"],
  [47323,  "Mikel Oyarzabal"],
  [47315,  "Martín Zubimendi"],
  [47380,  "Marc Cucurella"],
  [563,    "Alejandro Grimaldo"],
  [753,    "Marcos Llorente"],
  [44,     "Rodri"],
  [184226, "Yeremy Pino"],
  [396623, "Pau Cubarsí"],
  [47348,  "Borja Iglesias"],
  [931,    "Ferran Torres"],
  [47270,  "Unai Simón"],
  [622,    "Aymeric Laporte"],
  [19465,  "David Raya"],
  [182218, "Joan García"],
  [182219, "Álex Baena"],
  [182718, "Joan García"],
  [386828, "Lamine Yamal"],
  // Argentina (just the headliners with long full names)
  [154,    "Lionel Messi"],
  [6009,   "Julián Álvarez"],
  [217,    "Lautaro Martínez"],
  // France
  [278,    "Kylian Mbappé"],
  [153,    "Ousmane Dembélé"],
  [21509,  "Marcus Thuram"],
  [1271,   "Aurélien Tchouaméni"],
  [1145,   "Ibrahima Konaté"],
  // England (most are short and already match — only a few worth touching)
  [158694, "Tino Livramento"],
  [136723, "Noni Madueke"],
  [67971,  "Marc Guéhi"],
];

const sql = postgres(url, { max: 1, prepare: false });
try {
  let updated = 0, skipped = 0, notfound = 0;
  for (const [id, name] of STAGE_NAMES) {
    const row = (await sql`select api_football_id, name_en from public.players where api_football_id = ${id}`)[0];
    if (!row) { notfound += 1; console.log(`  ! ${id} ${name} — not in DB`); continue; }
    if (row.name_en === name) { skipped += 1; continue; }
    console.log(`  ${row.name_en.padEnd(48)} → ${name}`);
    if (isApply) {
      await sql`update public.players set name_en = ${name}, updated_at = now() where api_football_id = ${id}`;
    }
    updated += 1;
  }
  console.log(`\n${isApply ? "Applied" : "Dry run"}: ${updated} updated, ${skipped} already correct, ${notfound} missing from DB.`);
} finally { await sql.end(); }
