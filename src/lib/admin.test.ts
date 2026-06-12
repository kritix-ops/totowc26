import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSION_KEYS,
  PERMISSION_PATHS,
  grantedPathsFor,
  hasAnyPermission,
  isPermittedPath,
  normalizePermissions,
} from "./admin-paths";

// Pure-function tests for the permission catalog + path matcher. The
// async helpers (requireAdminAccess, hasPermission, etc.) hit the DB
// and live in integration territory; this file pins down the
// deterministic logic because a silent regression there means either a
// blocked admin (bad UX) or, worse, a scoped operator reaching a page
// they shouldn't (security).

describe("normalizePermissions", () => {
  it("keeps recognised true flags", () => {
    expect(normalizePermissions({ liveBets: true })).toEqual({ liveBets: true });
    expect(normalizePermissions({ liveBets: true, tournamentBets: true })).toEqual({
      liveBets: true,
      tournamentBets: true,
    });
  });

  it("drops false / non-true values", () => {
    expect(normalizePermissions({ liveBets: false })).toEqual({});
    expect(normalizePermissions({ liveBets: 1 })).toEqual({});
    expect(normalizePermissions({ liveBets: "true" })).toEqual({});
  });

  it("drops unknown keys (the allowlist defends the API boundary)", () => {
    expect(normalizePermissions({ liveBets: true, nukeAccount: true })).toEqual({
      liveBets: true,
    });
  });

  it("returns empty for non-objects, arrays, and null", () => {
    expect(normalizePermissions(null)).toEqual({});
    expect(normalizePermissions(undefined)).toEqual({});
    expect(normalizePermissions([])).toEqual({});
    expect(normalizePermissions("liveBets")).toEqual({});
    expect(normalizePermissions(42)).toEqual({});
  });
});

describe("hasAnyPermission", () => {
  it("returns false for an empty object", () => {
    expect(hasAnyPermission({})).toBe(false);
  });
  it("returns true when at least one key is true", () => {
    expect(hasAnyPermission({ liveBets: true })).toBe(true);
    expect(hasAnyPermission({ tournamentOdds: true })).toBe(true);
  });
  it("returns false when keys are explicit false", () => {
    expect(hasAnyPermission({ liveBets: false })).toBe(false);
  });
});

describe("grantedPathsFor", () => {
  it("returns no paths for an empty permission set", () => {
    expect(grantedPathsFor({})).toEqual([]);
  });

  it("includes the bare admin path when at least one permission is granted", () => {
    expect(grantedPathsFor({ liveBets: true })).toContain("");
  });

  it("maps each permission to its declared path list", () => {
    expect(grantedPathsFor({ liveBets: true })).toEqual([
      "",
      ...PERMISSION_PATHS.liveBets,
    ]);
  });

  it("unions across multiple permissions without duplicates of the root", () => {
    const out = grantedPathsFor({ liveBets: true, tournamentOdds: true });
    expect(out.filter((p) => p === "")).toHaveLength(1);
    for (const p of PERMISSION_PATHS.liveBets) expect(out).toContain(p);
    for (const p of PERMISSION_PATHS.tournamentOdds) expect(out).toContain(p);
  });
});

describe("isPermittedPath", () => {
  it("denies every path for an empty permission set", () => {
    expect(isPermittedPath({}, "")).toBe(false);
    expect(isPermittedPath({}, "bets")).toBe(false);
  });

  it("allows the bare admin path for any operator", () => {
    expect(isPermittedPath({ liveBets: true }, "")).toBe(true);
    expect(isPermittedPath({ tournamentOdds: true }, "")).toBe(true);
  });

  it("allows sub-paths under a granted prefix", () => {
    expect(isPermittedPath({ liveBets: true }, "bets/new")).toBe(true);
    expect(isPermittedPath({ liveBets: true }, "bets/abc-123/edit")).toBe(true);
    expect(isPermittedPath({ liveBets: true }, "live-bets/suggestions")).toBe(true);
    expect(isPermittedPath({ tournamentBets: true }, "tournament-suggestions")).toBe(true);
  });

  it("denies prefix-match collisions (fail-closed)", () => {
    // 'bets-something-else' shares letters with 'bets' but isn't a sub-path
    expect(isPermittedPath({ liveBets: true }, "betsx")).toBe(false);
    expect(isPermittedPath({ liveBets: true }, "bets-something")).toBe(false);
    expect(isPermittedPath({ tournamentBets: true }, "tournament-odds")).toBe(false);
  });

  it("denies paths granted by a different permission", () => {
    expect(isPermittedPath({ liveBets: true }, "tournament-suggestions")).toBe(false);
    expect(isPermittedPath({ liveBets: true }, "tournament-odds")).toBe(false);
    expect(isPermittedPath({ tournamentBets: true }, "bets")).toBe(false);
    expect(isPermittedPath({ tournamentOdds: true }, "deadlines")).toBe(false);
  });

  it("denies admin-only surfaces under every scoped permission", () => {
    for (const k of ADMIN_PERMISSION_KEYS) {
      const perms = { [k]: true };
      expect(isPermittedPath(perms, "users")).toBe(false);
      expect(isPermittedPath(perms, "system")).toBe(false);
      expect(isPermittedPath(perms, "settings")).toBe(false);
      expect(isPermittedPath(perms, "broadcast")).toBe(false);
      expect(isPermittedPath(perms, "sandbox")).toBe(false);
    }
  });
});

describe("permission catalog sanity", () => {
  it("declares a non-empty path list for every known permission", () => {
    for (const k of ADMIN_PERMISSION_KEYS) {
      expect(PERMISSION_PATHS[k].length).toBeGreaterThan(0);
    }
  });
});
