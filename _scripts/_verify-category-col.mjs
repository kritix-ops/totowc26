import postgres from "postgres";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.sandbox.local", "utf8");
const url = env.match(/^SANDBOX_DIRECT_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1, prepare: false });
const col = await sql`
  select column_name, data_type, udt_name, is_nullable
  from information_schema.columns
  where table_name='custom_bets' and column_name='category'`;
const vals = await sql`select enum_range(null::live_bet_category) as vals`;
console.log("column:", col[0] ?? "MISSING");
console.log("enum values:", vals[0].vals);
await sql.end();
