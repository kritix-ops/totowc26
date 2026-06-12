import "server-only";
import { sql } from "drizzle-orm";
import { execRows } from "@/db/helpers";
import type { PlayerNameMap } from "@/lib/bets/format";

// Resolves the player markets (top scorer / golden ball) whose picks store a
// raw api_football_id rather than a label — see renderPickAnswer. One small
// query for the whole roster (~1,357 rows), returned as a lookup keyed by id
// as a string (the pick value is stored as a string). name_he can be null for
// not-yet-translated players, so we fall back to name_en.
export async function fetchPlayerNamesById(): Promise<PlayerNameMap> {
  const rows = await execRows<{
    apiFootballId: number;
    nameHe: string | null;
    nameEn: string;
  }>(sql`
    select
      p.api_football_id   as "apiFootballId",
      p.name_he           as "nameHe",
      p.name_en           as "nameEn"
    from public.players p
  `);
  const map: PlayerNameMap = new Map();
  for (const r of rows) {
    map.set(String(r.apiFootballId), {
      he: r.nameHe ?? r.nameEn,
      en: r.nameEn,
    });
  }
  return map;
}
