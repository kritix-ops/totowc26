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

// Interactive transports = the entry points that a real human's tap
// reaches. Some build the principal inline (`buildsPrincipal: true`);
// others delegate the actual write to a shared core
// (`buildsPrincipal: false`) and only need to forward the session
// user's id into it. Either way the rule is the same: the userId that
// ends up in the principal must come from getUser(), never from a
// request body or a hardcoded value.
const INTERACTIVE_WRITERS = [
  {
    name: "saveBet server action (1/X/2)",
    path: "src/app/[lang]/bets/[matchId]/actions.ts",
    buildsPrincipal: false,
  },
  {
    name: "saveBet route handler (1/X/2)",
    path: "src/app/api/bets/save/route.ts",
    buildsPrincipal: false,
  },
  {
    name: "submitCustomBetPick server action",
    path: "src/app/[lang]/play/[date]/actions.ts",
    buildsPrincipal: true,
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

// Owner-explicit cancel: a signed-in user removing their own pick. The
// carve-out the "user bets are SACRED" memory permits. Each cancel
// transport must source the userId from getUser() (never the request
// body) and route the destructive call through the write-core's
// self-only entrypoint — admin_proxy is forbidden on this path because
// admin clear has its own audited path elsewhere.
const CANCEL_TRANSPORTS = [
  {
    name: "cancelBet server action (1/X/2)",
    path: "src/app/[lang]/bets/[matchId]/actions.ts",
  },
  {
    name: "cancelBet route handler (1/X/2)",
    path: "src/app/api/bets/cancel/route.ts",
  },
  {
    name: "cancelCustomBetPick server action",
    path: "src/app/[lang]/play/[date]/actions.ts",
  },
] as const;

describe.each(CANCEL_TRANSPORTS)(
  "owner-cancel transport: $name",
  ({ path: relPath }) => {
    const code = stripComments(read(relPath));

    it("sources the userId from the live session via getUser()", () => {
      expect(code).toMatch(/const\s+user\s*=\s*await\s+getUser\s*\(\s*\)/);
    });

    it("forwards the session user's own id (user.id), not a body-supplied or hardcoded one", () => {
      expect(code).toMatch(/userId\s*:\s*user\.id|userId\s*:\s*input\.userId/);
    });

    it("never constructs an admin_proxy principal (admin clear has its own audited path)", () => {
      expect(code).not.toMatch(/kind\s*:\s*["']admin_proxy["']/);
    });

    it("never constructs a system principal (cron has no cancel pass)", () => {
      expect(code).not.toMatch(/kind\s*:\s*["']system["']/);
    });
  },
);

describe("cancel-match-pick-core: shared cancel helper", () => {
  const code = stripComments(read("src/lib/bets/cancel-match-pick-core.ts"));

  it("builds a self principal, never a system or admin_proxy one", () => {
    expect(code).toMatch(/kind\s*:\s*["']self["']/);
    expect(code).not.toMatch(/kind\s*:\s*["']system["']/);
    expect(code).not.toMatch(/kind\s*:\s*["']admin_proxy["']/);
  });

  it("keys the principal on the input.userId the transport forwarded", () => {
    expect(code).toMatch(/userId\s*:\s*input\.userId/);
  });

  it("delegates the destructive write to cancelMatchPickSelf", () => {
    expect(code).toMatch(/cancelMatchPickSelf/);
  });
});

describe("write-core: owner-cancel entrypoints reject non-self principals", () => {
  const code = stripComments(read("src/lib/bets/write-core.ts"));

  it.each(["cancelMatchPickSelf", "cancelCustomPickSelf"])(
    "%s short-circuits when principal.kind !== 'self'",
    (fn) => {
      const start = code.indexOf(`function ${fn}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const after = code.indexOf("\nexport ", start + 1);
      const body = code.slice(start, after > start ? after : code.length);
      expect(body).toMatch(/principal\.kind\s*!==\s*["']self["']/);
    },
  );

  it.each(["cancelMatchPickSelf", "cancelCustomPickSelf"])(
    "%s re-runs the lock gate (effectiveLockAt comparison)",
    (fn) => {
      const start = code.indexOf(`function ${fn}`);
      const after = code.indexOf("\nexport ", start + 1);
      const body = code.slice(start, after > start ? after : code.length);
      expect(body).toMatch(/effectiveLockAt/);
    },
  );
});

describe.each(INTERACTIVE_WRITERS)(
  "interactive bet writer: $name",
  ({ path: relPath, buildsPrincipal }) => {
    const code = stripComments(read(relPath));

    it("sources the userId from the live session via getUser()", () => {
      expect(code).toMatch(/const\s+user\s*=\s*await\s+getUser\s*\(\s*\)/);
    });

    it("forwards the session user's own id (user.id), not a body-supplied or hardcoded one", () => {
      expect(code).toMatch(/userId\s*:\s*user\.id/);
    });

    if (buildsPrincipal) {
      it("builds a self principal, never a system principal", () => {
        expect(code).toMatch(/kind\s*:\s*["']self["']/);
        expect(code).not.toMatch(/kind\s*:\s*["']system["']/);
      });
    } else {
      // Delegates the actual write to save-match-pick-core. The
      // principal is built there, asserted in its own block below.
      it("delegates the write to performSaveMatchPick (shared core)", () => {
        expect(code).toMatch(/performSaveMatchPick/);
      });
    }
  },
);

describe("save-match-pick-core: shared interactive write helper", () => {
  const code = stripComments(read("src/lib/bets/save-match-pick-core.ts"));

  it("builds a self principal, never a system principal", () => {
    expect(code).toMatch(/kind\s*:\s*["']self["']/);
    expect(code).not.toMatch(/kind\s*:\s*["']system["']/);
  });

  it("keys the principal on the input.userId the transport forwarded", () => {
    expect(code).toMatch(/userId\s*:\s*input\.userId/);
  });
});

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

describe("admin proxy path: gated, reasoned, audited", () => {
  const adminActionsPath = "src/app/[lang]/admin/users/[id]/bets/actions.ts";
  const adminActions = stripComments(read(adminActionsPath));
  const writeCore = stripComments(read("src/lib/bets/write-core.ts"));

  it("admin actions file enforces an isAdmin gate before any write-core call", () => {
    expect(adminActions).toMatch(/isAdmin\s*\(/);
    expect(adminActions).toMatch(
      /from\s+["']@\/lib\/admin["']|from\s+["']\.\.\/+admin["']/,
    );
  });

  it("admin actions file sources the admin id from getUser(), not the request body", () => {
    expect(adminActions).toMatch(/const\s+user\s*=\s*await\s+getUser\s*\(\s*\)/);
    expect(adminActions).toMatch(/adminId\s*:\s*user\.id|adminId\s*:\s*guard\.adminId/);
  });

  it("admin actions file builds an admin_proxy principal — never self or system", () => {
    expect(adminActions).toMatch(/kind\s*:\s*["']admin_proxy["']/);
    expect(adminActions).not.toMatch(/kind\s*:\s*["']self["']/);
    expect(adminActions).not.toMatch(/kind\s*:\s*["']system["']/);
  });

  it("admin actions file blocks self-targeting (admin editing their own pick)", () => {
    expect(adminActions).toMatch(/self_target/);
  });

  it("admin actions file requires a non-empty reason on every action", () => {
    const actionFns = [
      /adminSetCustomBetPick/,
      /adminClearCustomBetPick/,
      /adminSetMatchPick/,
      /adminClearMatchPick/,
    ];
    for (const re of actionFns) {
      expect(adminActions).toMatch(re);
    }
    expect(adminActions).toMatch(/validateReason|reason\.trim\(\)\.length\s*>\s*0/);
  });

  it("write-core's admin entrypoints all assert a non-empty reason", () => {
    expect(writeCore).toMatch(/assertAdminReason/);
    const adminFns = [
      "writeMatchPickAdmin",
      "clearMatchPickAdmin",
      "writeCustomPickAdmin",
      "clearCustomPickAdmin",
    ];
    for (const fn of adminFns) {
      // Each admin fn body should mention assertAdminReason.
      const fnStart = writeCore.indexOf(`function ${fn}`);
      const fnEnd = writeCore.indexOf(`\nexport `, fnStart + 1);
      const fnBody = writeCore.slice(
        fnStart,
        fnEnd > fnStart ? fnEnd : writeCore.length,
      );
      expect(fnBody).toMatch(/assertAdminReason/);
    }
  });

  it("write-core's admin entrypoints insert a bet_admin_audit row", () => {
    const adminFns = [
      "writeMatchPickAdmin",
      "clearMatchPickAdmin",
      "writeCustomPickAdmin",
      "clearCustomPickAdmin",
    ];
    for (const fn of adminFns) {
      const fnStart = writeCore.indexOf(`function ${fn}`);
      const fnEnd = writeCore.indexOf(`\nexport `, fnStart + 1);
      const fnBody = writeCore.slice(
        fnStart,
        fnEnd > fnStart ? fnEnd : writeCore.length,
      );
      expect(fnBody).toMatch(/tx\.insert\s*\(\s*betAdminAudit\s*\)/);
    }
  });

  it("non-admin writers never construct an admin_proxy principal", () => {
    for (const { path: relPath } of AUTOMATED_WRITERS) {
      const code = stripComments(read(relPath));
      expect(code).not.toMatch(/kind\s*:\s*["']admin_proxy["']/);
    }
    for (const { path: relPath } of INTERACTIVE_WRITERS) {
      const code = stripComments(read(relPath));
      expect(code).not.toMatch(/kind\s*:\s*["']admin_proxy["']/);
    }
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
