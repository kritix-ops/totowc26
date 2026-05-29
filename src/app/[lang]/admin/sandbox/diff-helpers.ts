import "server-only";
import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { db } from "@/db";
import { prodDb } from "@/db/prod-db";

// Columns we exclude from settings sync. `id` is the PK (always 1) and
// `updatedAt` is a write-timestamp that would always show as different.
// Everything else in the settings table is in scope for promote.
const EXCLUDED_COLUMNS = new Set(["id", "updatedAt"]);

export type SettingsRow = Awaited<ReturnType<typeof readSettings>>;

export async function readSettings(client: typeof db) {
  const [row] = await client
    .select()
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  if (!row) {
    throw new Error("settings row (id=1) missing");
  }
  return row;
}

export type SettingsDiffEntry = {
  column: keyof SettingsRow & string;
  sandboxValue: unknown;
  prodValue: unknown;
};

// Returns one entry per column whose value differs between sandbox and
// prod. Uses JSON.stringify for the comparison so jsonb columns
// (mobileNavConfig, hiddenPages) and Date values are compared structurally.
export function diffSettings(
  sandboxRow: SettingsRow,
  prodRow: SettingsRow,
): SettingsDiffEntry[] {
  const out: SettingsDiffEntry[] = [];
  for (const key of Object.keys(sandboxRow) as (keyof SettingsRow & string)[]) {
    if (EXCLUDED_COLUMNS.has(key)) continue;
    const a = sandboxRow[key];
    const b = prodRow[key];
    if (!sameValue(a, b)) {
      out.push({ column: key, sandboxValue: a, prodValue: b });
    }
  }
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// Reads both settings rows (sandbox = local, prod = remote) and returns
// the entries that differ. The two reads run in parallel.
export async function loadSettingsDiff(): Promise<{
  sandbox: SettingsRow;
  prod: SettingsRow;
  diff: SettingsDiffEntry[];
}> {
  const [sandbox, prod] = await Promise.all([
    readSettings(db),
    readSettings(prodDb()),
  ]);
  return { sandbox, prod, diff: diffSettings(sandbox, prod) };
}
