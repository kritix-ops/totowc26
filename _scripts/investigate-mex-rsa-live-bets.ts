import { config } from "dotenv";
config({ path: ".env.local" });

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function rest(path: string) {
  const r = await fetch(`${supaUrl}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${await r.text()}`);
  return r.json();
}

function fmtJerusalem(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

async function main() {
  // 1. Find Mexico & South Africa team codes
  const teams = (await rest(
    "teams?select=code,name_he,name_en&limit=500",
  )) as any[];
  const mex = teams.find(
    (t) => /mexico/i.test(t.name_en) || /מקסיקו/.test(t.name_he) || t.code === "MEX",
  );
  const rsa = teams.find(
    (t) =>
      /south africa/i.test(t.name_en) ||
      /דרום אפריקה/.test(t.name_he) ||
      ["RSA", "SAF"].includes(t.code),
  );
  console.log(`Mexico: ${JSON.stringify(mex)}`);
  console.log(`South Africa: ${JSON.stringify(rsa)}`);
  if (!mex || !rsa) {
    console.log("Could not find both teams.");
    return;
  }

  // 2. Find matches between them
  const matches = (await rest(
    `matches?or=(and(home_team.eq.${mex.code},away_team.eq.${rsa.code}),and(home_team.eq.${rsa.code},away_team.eq.${mex.code}))&select=*&order=kickoff_at.desc`,
  )) as any[];

  console.log(`\nMexico vs South Africa matches: ${matches.length}`);
  for (const m of matches) {
    console.log(
      `  ${m.id}  ${fmtJerusalem(m.kickoff_at)}  ${m.home_team} ${m.home_score ?? "-"} : ${m.away_score ?? "-"} ${m.away_team}  [${m.status}]  stage=${m.stage} group=${m.group_id}`,
    );
  }

  if (matches.length === 0) return;

  for (const match of matches) {
    console.log(
      `\n=========================================================`,
    );
    console.log(
      `Match ${match.id}: ${match.home_team} vs ${match.away_team} @ ${fmtJerusalem(match.kickoff_at)}`,
    );
    console.log(
      `Final: ${match.home_score ?? "-"} : ${match.away_score ?? "-"}  status=${match.status}  HT=${match.ht_home_score ?? "-"}:${match.ht_away_score ?? "-"}  pens=${match.went_to_penalties ?? false}`,
    );

    // 3. Custom bets scoped to this match (live = match scope)
    const bets = (await rest(
      `custom_bets?match_id=eq.${match.id}&scope=eq.match&select=*&order=created_at.asc`,
    )) as any[];
    console.log(`\nLive (match-scope) custom bets: ${bets.length}`);

    for (const b of bets) {
      console.log(`\n  ── BET ${b.id.slice(0, 8)} ──`);
      console.log(`  Q (he): ${b.question_he}`);
      console.log(`  Q (en): ${b.question_en}`);
      console.log(`  Answer type: ${b.answer_type}`);
      console.log(
        `  Stake: ${b.stake_snapshot}   Payout: ${b.payout_snapshot}   Decimal odds: ${b.decimal_odds ?? "—"}`,
      );
      console.log(
        `  Status: ${b.status}   Lock at: ${fmtJerusalem(b.lock_at)}`,
      );
      console.log(`  Grading source: ${b.grading_source}`);
      if (b.resolved_value != null) {
        console.log(`  Resolved: ${JSON.stringify(b.resolved_value)}`);
      }
      if (b.answer_type === "multi_choice" && b.answer_config?.options) {
        console.log(`  Options (per-option pricing):`);
        for (const opt of b.answer_config.options) {
          console.log(
            `    • ${opt.value}  [${opt.labelHe ?? ""} / ${opt.labelEn ?? ""}]  ` +
              `payout=${opt.payoutOverride ?? b.payout_snapshot}  ` +
              `odds=${opt.decimalOdds ?? b.decimal_odds ?? "—"}`,
          );
        }
      }
      if (b.grading_config) {
        console.log(`  grading_config: ${JSON.stringify(b.grading_config)}`);
      }

      // 4. Picks on this bet
      const picks = (await rest(
        `user_custom_bet_picks?custom_bet_id=eq.${b.id}&select=*`,
      )) as any[];
      console.log(`  Picks: ${picks.length}`);
      if (picks.length > 0) {
        const userIds = Array.from(new Set(picks.map((p) => p.user_id)));
        const profiles = (await rest(
          `profiles?id=in.(${userIds.join(",")})&select=id,display_name,is_bot`,
        )) as any[];
        const byId = new Map(profiles.map((p) => [p.id, p]));
        for (const p of picks) {
          const u = byId.get(p.user_id);
          const who =
            (u?.display_name ?? p.user_id.slice(0, 8)) +
            (u?.is_bot ? " (bot)" : "");
          console.log(
            `    - ${who.padEnd(20)} answer=${JSON.stringify(p.answer).padEnd(25)} stake=${p.stake_paid} payout=${p.payout_snapshot ?? "(bet)"} correct=${p.was_correct ?? "—"} pts=${p.points_earned ?? "—"} locked=${p.locked}`,
          );
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
