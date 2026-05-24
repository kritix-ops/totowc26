/**
 * Seeds teams and group-stage fixtures for FIFA World Cup 2026.
 * Idempotent: re-running will not duplicate rows.
 *
 * Run: pnpm db:seed
 *
 * Notes:
 * - Group assignments and fixtures here are a plausible illustrative set.
 *   Replace with the real draw output once it is published.
 * - Times are stored in UTC.
 */

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Did you create .env.local?");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 5 });

const TEAMS = [
  // Hosts
  ["USA", "ארה\"ב", "USA", "🇺🇸", "A"],
  ["MEX", "מקסיקו", "Mexico", "🇲🇽", "A"],
  ["CAN", "קנדה", "Canada", "🇨🇦", "B"],
  // CONMEBOL
  ["BRA", "ברזיל", "Brazil", "🇧🇷", "C"],
  ["ARG", "ארגנטינה", "Argentina", "🇦🇷", "D"],
  ["URU", "אורוגוואי", "Uruguay", "🇺🇾", "E"],
  ["COL", "קולומביה", "Colombia", "🇨🇴", "F"],
  ["ECU", "אקוודור", "Ecuador", "🇪🇨", "G"],
  ["PAR", "פרגוואי", "Paraguay", "🇵🇾", "H"],
  // UEFA
  ["FRA", "צרפת", "France", "🇫🇷", "D"],
  ["GER", "גרמניה", "Germany", "🇩🇪", "C"],
  ["ESP", "ספרד", "Spain", "🇪🇸", "B"],
  ["ITA", "איטליה", "Italy", "🇮🇹", "F"],
  ["ENG", "אנגליה", "England", "🇬🇧", "E"],
  ["POR", "פורטוגל", "Portugal", "🇵🇹", "G"],
  ["NED", "הולנד", "Netherlands", "🇳🇱", "H"],
  ["BEL", "בלגיה", "Belgium", "🇧🇪", "A"],
  ["CRO", "קרואטיה", "Croatia", "🇭🇷", "I"],
  ["DEN", "דנמרק", "Denmark", "🇩🇰", "I"],
  ["SUI", "שוויץ", "Switzerland", "🇨🇭", "J"],
  ["POL", "פולין", "Poland", "🇵🇱", "J"],
  ["AUT", "אוסטריה", "Austria", "🇦🇹", "K"],
  ["NOR", "נורווגיה", "Norway", "🇳🇴", "L"],
  ["TUR", "טורקיה", "Turkey", "🇹🇷", "K"],
  ["UKR", "אוקראינה", "Ukraine", "🇺🇦", "L"],
  // AFC
  ["JPN", "יפן", "Japan", "🇯🇵", "B"],
  ["KOR", "דרום קוריאה", "South Korea", "🇰🇷", "I"],
  ["IRN", "איראן", "Iran", "🇮🇷", "J"],
  ["AUS", "אוסטרליה", "Australia", "🇦🇺", "K"],
  ["KSA", "ערב הסעודית", "Saudi Arabia", "🇸🇦", "F"],
  // CAF
  ["MAR", "מרוקו", "Morocco", "🇲🇦", "G"],
  ["SEN", "סנגל", "Senegal", "🇸🇳", "H"],
  ["NGA", "ניגריה", "Nigeria", "🇳🇬", "L"],
  ["EGY", "מצרים", "Egypt", "🇪🇬", "E"],
];

const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

const KICKOFF_BASE = new Date("2026-06-11T19:00:00Z");

function kickoff(daysFromStart, hourUtc = 19) {
  const d = new Date(KICKOFF_BASE);
  d.setUTCDate(d.getUTCDate() + daysFromStart);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}

const MATCHES = [
  // Matchday 1
  ["group", "A", "MEX", "BEL", kickoff(0, 19), "Estadio Azteca, Mexico City"],
  ["group", "B", "USA", "JPN", kickoff(0, 22), "MetLife Stadium, NJ"],
  ["group", "C", "BRA", "GER", kickoff(1, 19), "AT&T Stadium, Dallas"],
  ["group", "D", "ARG", "FRA", kickoff(1, 22), "SoFi Stadium, LA"],
  ["group", "E", "ENG", "EGY", kickoff(2, 19), "BMO Field, Toronto"],
  ["group", "F", "ESP", "ITA", kickoff(2, 22), "Lincoln Financial, Philadelphia"],
  ["group", "G", "POR", "MAR", kickoff(3, 19), "Gillette Stadium, Boston"],
  ["group", "H", "NED", "SEN", kickoff(3, 22), "Lumen Field, Seattle"],
  // Matchday 2 sample
  ["group", "B", "CAN", "ESP", kickoff(5, 19), "BC Place, Vancouver"],
];

async function upsertGroups() {
  for (let i = 0; i < GROUPS.length; i++) {
    await sql`
      insert into groups (id, display_order)
      values (${GROUPS[i]}, ${i + 1})
      on conflict (id) do update set display_order = excluded.display_order
    `;
  }
  console.log(`✓ upserted ${GROUPS.length} groups`);
}

async function upsertTeams() {
  for (const [code, nameHe, nameEn, flag, groupId] of TEAMS) {
    await sql`
      insert into teams (code, name_he, name_en, flag, group_id)
      values (${code}, ${nameHe}, ${nameEn}, ${flag}, ${groupId})
      on conflict (code) do update set
        name_he = excluded.name_he,
        name_en = excluded.name_en,
        flag = excluded.flag,
        group_id = excluded.group_id
    `;
  }
  console.log(`✓ upserted ${TEAMS.length} teams`);
}

async function upsertMatches() {
  // Wipe group-stage matches so the seed stays idempotent without needing
  // stable synthetic ids.
  await sql`delete from matches where stage = 'group'`;
  for (const [stage, groupId, home, away, time, venue] of MATCHES) {
    await sql`
      insert into matches (stage, group_id, home_team, away_team, kickoff_at, venue, status)
      values (${stage}, ${groupId}, ${home}, ${away}, ${time.toISOString()}, ${venue}, 'scheduled')
    `;
  }
  console.log(`✓ inserted ${MATCHES.length} matches`);
}

try {
  await upsertGroups();
  await upsertTeams();
  await upsertMatches();
  console.log("seed done");
} catch (err) {
  console.error("seed failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
