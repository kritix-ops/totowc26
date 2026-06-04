import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Sacred-invariant guards: a user's already-placed pick must never be
// silently mutated by an automated path. This test enforces the contract
// at the source level — it does not need a database. A future PR that
// regresses any of these properties will turn this file red in CI.
//
// The properties enforced:
//   (1) Every automated bet-writer (Surprise Me, the Monkey cron, the
//       deadline grace auto-fill) calls write-core with `overwrite: false`
//       and never `overwrite: true`.
//   (2) Every interactive bet-writer (saveBet, submitCustomBetPick) — the
//       only two callers permitted to overwrite — builds its principal
//       from the live session via `getUser()`, never from a raw userId,
//       so one user cannot write to another user's row.
//   (3) The write-core itself preserves the never-overwrite gates:
//       `onConflictDoNothing` on match picks and an explicit "skip if
//       existing and !overwrite" branch on custom picks.
//   (4) The sandbox refresh-from-prod table list excludes every user-bet
//       table, and the sandbox push-settings-to-prod only touches the
//       settings table.

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

// Strip JS/TS comments so a phrase that appears only in a comment (e.g.
// the explanatory header on this file's behaviour) is not mistaken for
// code that performs the action.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const AUTOMATED_WRITERS = [
  {
    name: "Surprise Me (random-actions)",
    path: "src/app/[lang]/bets/random-actions.ts",
  },
  { name: "Monkey cron", path: "src/lib/bets/monkey.ts" },
  { name: "Deadline grace auto-fill", path: "src/lib/bets/auto-fill.ts" },
] as const;

const INTERACTIVE_WRITERS = [
  { name: "saveBet (1/X/2)", path: "src/app/[lang]/bets/[matchId]/actions.ts" },
  {
    name: "submitCustomBetPick",
    path: "src/app/[lang]/play/[date]/actions.ts",
  },
] as const;

describe.each(AUTOMATED_WRITERS)(
  "automated bet writer: $name",
  ({ path: relPath }) => {
    const code = stripComments(read(relPath));

    it("explicitly sets overwrite: false at least once", () => {
      expect(code).toMatch(/overwrite\s*:\s*false/);
    });

    it("never sets overwrite: true (would let it stomp on a user's pick)", () => {
      expect(code).not.toMatch(/overwrite\s*:\s*true/);
    });

    it("imports a write-core writer (sanity: we're checking the right file)", () => {
      expect(code).toMatch(
        /from\s+["']@\/lib\/bets\/write-core["']|from\s+["']\.\/write-core["']/,
      );
      expect(code).toMatch(
        /writeMatchPick|writeCustomPick|writeCustomPicksBulk/,
      );
    });
  },
);

describe.each(INTERACTIVE_WRITERS)(
  "interactive bet writer: $name",
  ({ path: relPath }) => {
    const code = stripComments(read(relPath));

    it("sources the userId from the live session via getUser()", () => {
      expect(code).toMatch(/const\s+user\s*=\s*await\s+getUser\s*\(\s*\)/);
    });

    it("builds a self principal, never a system principal", () => {
      expect(code).toMatch(/kind\s*:\s*["']self["']/);
      expect(code).not.toMatch(/kind\s*:\s*["']system["']/);
    });

    it("keys the principal on the session user's own id", () => {
      expect(code).toMatch(/userId\s*:\s*user\.id/);
    });
  },
);

describe("write-core: never-overwrite gates", () => {
  const code = stripComments(read("src/lib/bets/write-core.ts"));

  it("match writes use onConflictDoNothing on the (userId, matchId) unique key", () => {
    expect(code).toMatch(
      /onConflictDoNothing\s*\(\s*\{\s*target\s*:\s*\[\s*matchBets\.userId\s*,\s*matchBets\.matchId\s*\]/,
    );
  });

  it("custom writes skip when an existing pick is present and overwrite is false", () => {
    expect(code).toMatch(/if\s*\(\s*existing\s*&&\s*!opts\.overwrite\s*\)/);
    expect(code).toMatch(/reason\s*:\s*["']already_filled["']/);
  });

  it("custom writes always skip an already-locked pick, even with overwrite: true", () => {
    expect(code).toMatch(/existing\?\.locked/);
  });

  it("WriteOpts.overwrite is a required boolean (no implicit default)", () => {
    expect(code).toMatch(/overwrite\s*:\s*boolean/);
  });
});

describe("sandbox refresh-from-prod: bet tables are excluded", () => {
  const code = read("src/app/[lang]/admin/sandbox/actions.ts");
  const start = code.indexOf("const REFRESH_TABLES");
  const end = code.indexOf("] as const", start);
  const block = code.slice(start, end);

  it("REFRESH_TABLES is present in the sandbox actions file", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
  });

  it.each([
    "matchBets",
    "customBets",
    "userCustomBetPicks",
    "duels",
    "match_bets",
    "custom_bets",
    "user_custom_bet_picks",
  ])("does not list bet table %s", (table) => {
    const re = new RegExp(`(?<![A-Za-z_])${table}(?![A-Za-z_])`);
    expect(block).not.toMatch(re);
  });
});

describe("sandbox push-settings-to-prod: only touches the settings table", () => {
  const code = read("src/app/[lang]/admin/sandbox/actions.ts");
  const start = code.indexOf("export async function pushSettingsToProd");
  const after = code.indexOf("\nexport ", start + 1);
  const fn = stripComments(code.slice(start, after));

  it("calls .update(settings) on the settings table", () => {
    expect(fn).toMatch(/\.update\s*\(\s*settings\s*\)/);
  });

  it.each([
    "matchBets",
    "customBets",
    "userCustomBetPicks",
    "duels",
  ])("never writes to bet table %s", (table) => {
    const re = new RegExp(`\\.(update|insert|delete)\\s*\\(\\s*${table}\\b`);
    expect(fn).not.toMatch(re);
  });
});
