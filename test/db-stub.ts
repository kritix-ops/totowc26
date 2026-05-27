// Stub the vitest config aliases `@/db` to. The deadline resolver
// in src/lib/deadlines.ts imports `db` for getDeadlineContext but
// the pure resolvers we unit-test never reach it. Importing the real
// module would trip the env-var check inside src/db/index.ts and
// open a Postgres pool we have no use for.
//
// Re-exports schema so tests that need types (BetTypeKey, etc.) still
// find them - schema.ts itself is pure TypeScript with no runtime
// side effects.
export * from "../src/db/schema";
export const db = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "db accessed in a unit test. Mock the caller or test a pure function instead.",
      );
    },
  },
);
