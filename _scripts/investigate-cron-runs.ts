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

async function main() {
  // sync_runs around 19:00-20:00 UTC today
  const rows = (await rest(
    "sync_runs?started_at=gte.2026-06-11T18:00:00&select=*&order=started_at.asc",
  )) as any[];
  console.log(`sync_runs since 18:00 UTC today (${rows.length})`);
  for (const r of rows) {
    console.log(`  ${r.started_at} src=${r.source} ok=${r.ok} fetched=${r.fetched} inserted=${r.inserted} updated=${r.updated}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
