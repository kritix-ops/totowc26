import { describe, expect, it } from "vitest";
import { resolveLiveStake } from "./write-core";

// Pure-helper tests for the variable-stake clamp. The full
// writeCustomPickTx flow is integration-tested via the manual QA
// checklist in _plans/2026-06-11-variable-live-bet-stake.md §11 —
// stubbing the txn + advisory lock here would invert the dependency
// without catching anything the manual run misses.

describe("resolveLiveStake", () => {
  const cfg = { minStake: 1, maxStake: 30 };

  it("falls back to the bet's default stake when none is requested", () => {
    expect(resolveLiveStake(undefined, 3, cfg)).toEqual({
      stake: 3,
      clamped: false,
    });
  });

  it("uses the requested stake when it sits inside the admin range", () => {
    expect(resolveLiveStake(10, 3, cfg)).toEqual({
      stake: 10,
      clamped: false,
    });
    expect(resolveLiveStake(1, 3, cfg)).toEqual({
      stake: 1,
      clamped: false,
    });
    expect(resolveLiveStake(30, 3, cfg)).toEqual({
      stake: 30,
      clamped: false,
    });
  });

  it("clamps above-max to maxStake and flags it", () => {
    expect(resolveLiveStake(999, 3, cfg)).toEqual({
      stake: 30,
      clamped: true,
    });
  });

  it("clamps below-min to minStake and flags it", () => {
    expect(resolveLiveStake(0, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
    expect(resolveLiveStake(-5, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
  });

  it("treats non-integer / NaN as a tamper attempt — clamps to minStake", () => {
    expect(resolveLiveStake(NaN, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
    expect(resolveLiveStake(1.5, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
    expect(resolveLiveStake(Infinity, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
  });

  it("clamps fallback stake too when the bet's snapshot sits outside the new range", () => {
    // Admin tightens max after the bet was published at stake 50; the
    // fallback path still respects the new bound.
    expect(resolveLiveStake(undefined, 50, cfg)).toEqual({
      stake: 30,
      clamped: false,
    });
  });

  it("honours an admin override that allows a wider range", () => {
    const wide = { minStake: 1, maxStake: 100 };
    expect(resolveLiveStake(75, 3, wide)).toEqual({
      stake: 75,
      clamped: false,
    });
  });
});
