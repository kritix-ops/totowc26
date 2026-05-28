import "server-only";
import { sql, type SQLWrapper } from "drizzle-orm";
import { db } from "./index";

// Thin helpers around `db.execute` that hide the `as unknown as T[]`
// dance every raw-SQL call in this project used to write inline.
//
// Drizzle's `db.execute<TRow>(query)` resolves to a value whose public
// type is `PgRaw<PgQueryResultKind<...>>`, not `TRow[]`, so callers had
// to follow every call with `rows as unknown as TRow[]`. The cast is
// correct (postgres-js does return the rows array) but writing it at
// every call site is noise that hides the actual query intent.
//
// Usage:
//   const rows = await execRows<FixtureRow>(sql`select ... from public.matches`);
//   const first = await execFirstRow<{ pot: number }>(sql`select sum(...) as pot`);

// Run a raw SQL query and return its rows as `T[]`.
export async function execRows<T extends Record<string, unknown>>(
  query: SQLWrapper | string,
): Promise<T[]> {
  const result = await db.execute<T>(query);
  return result as unknown as T[];
}

// Run a raw SQL query and return the first row, or `null` if the query
// produced no rows. Documents the "look up by primary key, expect 0..1
// rows" intent at the call site.
export async function execFirstRow<T extends Record<string, unknown>>(
  query: SQLWrapper | string,
): Promise<T | null> {
  const rows = await execRows<T>(query);
  return rows[0] ?? null;
}

// Suppress the unused-import linter when this file is consumed only for
// its helpers and the caller never directly uses `sql`. Re-exported so
// callers that need to compose query fragments can `import { sql } from
// "@/db/helpers"` and avoid pulling drizzle-orm directly.
export { sql };
