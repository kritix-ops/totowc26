#!/usr/bin/env node
import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  const rows = await sql`
    select g.id as group_id, t.code, t.name_en
    from public.teams t
    join public.groups g on g.id = t.group_id
    order by g.id, t.name_en
  `;
  let last = "";
  for (const r of rows) {
    if (r.group_id !== last) { console.log(`\n--- Group ${r.group_id} ---`); last = r.group_id; }
    console.log(`  ${r.code}  ${r.name_en}`);
  }
} finally { await sql.end(); }
