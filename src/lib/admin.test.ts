import { describe, expect, it } from "vitest";
import { isLiveBetsAdminPath, LIVE_BETS_ADMIN_PATHS } from "./admin-paths";

// Pure-function test for the live-bets admin path whitelist. The async
// helpers (requireLiveBetsAdmin / isLiveBetsAdmin / requireAdmin / isAdmin)
// hit the DB so they live in integration territory; this file pins down
// the whitelist matcher because a silent regression there would mean
// either a denied admin (bad UX) or, worse, a live-bets admin reaching a
// page that isn't supposed to be theirs (security).

describe("isLiveBetsAdminPath", () => {
  it("permits the admin landing page itself", () => {
    expect(isLiveBetsAdminPath("")).toBe(true);
  });

  it("permits every whitelisted root path verbatim", () => {
    expect(isLiveBetsAdminPath("bets")).toBe(true);
    expect(isLiveBetsAdminPath("bets-overview")).toBe(true);
    expect(isLiveBetsAdminPath("live-bets")).toBe(true);
    expect(isLiveBetsAdminPath("deadlines")).toBe(true);
  });

  it("permits sub-paths of whitelisted roots", () => {
    expect(isLiveBetsAdminPath("bets/new")).toBe(true);
    expect(isLiveBetsAdminPath("bets/quick-add")).toBe(true);
    expect(isLiveBetsAdminPath("bets/duplicates")).toBe(true);
    expect(isLiveBetsAdminPath("bets/abc-123")).toBe(true);
    expect(isLiveBetsAdminPath("bets/abc-123/edit")).toBe(true);
    expect(isLiveBetsAdminPath("live-bets/suggestions")).toBe(true);
  });

  it("rejects every other admin path (fail-closed)", () => {
    expect(isLiveBetsAdminPath("users")).toBe(false);
    expect(isLiveBetsAdminPath("system")).toBe(false);
    expect(isLiveBetsAdminPath("payments")).toBe(false);
    expect(isLiveBetsAdminPath("signup-requests")).toBe(false);
    expect(isLiveBetsAdminPath("settings")).toBe(false);
    expect(isLiveBetsAdminPath("settings/scoring")).toBe(false);
    expect(isLiveBetsAdminPath("tournament-suggestions")).toBe(false);
    expect(isLiveBetsAdminPath("tournament-odds")).toBe(false);
    expect(isLiveBetsAdminPath("broadcast")).toBe(false);
    expect(isLiveBetsAdminPath("sandbox")).toBe(false);
  });

  it("does not treat a path that merely shares a prefix as a match", () => {
    // 'bets-something-else' is NOT 'bets' nor 'bets/...'.
    expect(isLiveBetsAdminPath("bets-something-else")).toBe(false);
    expect(isLiveBetsAdminPath("betsx")).toBe(false);
    expect(isLiveBetsAdminPath("deadlines-old")).toBe(false);
  });

  it("exposes the whitelist for inspection", () => {
    expect(LIVE_BETS_ADMIN_PATHS).toContain("bets");
    expect(LIVE_BETS_ADMIN_PATHS).toContain("bets-overview");
    expect(LIVE_BETS_ADMIN_PATHS).toContain("live-bets");
    expect(LIVE_BETS_ADMIN_PATHS).toContain("deadlines");
    expect(LIVE_BETS_ADMIN_PATHS).toHaveLength(5);
  });
});
