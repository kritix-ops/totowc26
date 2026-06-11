import { describe, expect, it } from "vitest";
import { assertBettingAllowed } from "./bank";

// Defaults shipped in migration 0050.
const CAP = 30;
const ON = true;
const OFF = false;

describe("assertBettingAllowed — happy paths", () => {
  it("accepts a bet fully covered by balance", () => {
    expect(
      assertBettingAllowed({ balance: 10, stake: 5, maxOverdraft: CAP, lockWhenNegative: ON }),
    ).toEqual({ ok: true });
  });

  it("accepts a bet that exactly empties the bank", () => {
    expect(
      assertBettingAllowed({ balance: 5, stake: 5, maxOverdraft: CAP, lockWhenNegative: ON }),
    ).toEqual({ ok: true });
  });

  it("accepts a bet that pushes balance to the overdraft floor", () => {
    // balance=10, stake=40 → after = -30, exactly -cap. Allowed.
    expect(
      assertBettingAllowed({ balance: 10, stake: 40, maxOverdraft: CAP, lockWhenNegative: ON }),
    ).toEqual({ ok: true });
  });

  it("accepts a bet from zero balance within cap", () => {
    expect(
      assertBettingAllowed({ balance: 0, stake: 20, maxOverdraft: CAP, lockWhenNegative: ON }),
    ).toEqual({ ok: true });
  });
});

describe("assertBettingAllowed — negative-balance lock", () => {
  it("locks new bets when balance is already < 0", () => {
    const r = assertBettingAllowed({
      balance: -1,
      stake: 1,
      maxOverdraft: CAP,
      lockWhenNegative: ON,
    });
    expect(r).toEqual({ ok: false, reason: "negative_balance_locked", balance: -1 });
  });

  it("locks even tiny bets when deeply negative", () => {
    const r = assertBettingAllowed({
      balance: -25,
      stake: 1,
      maxOverdraft: CAP,
      lockWhenNegative: ON,
    });
    expect(r).toEqual({ ok: false, reason: "negative_balance_locked", balance: -25 });
  });

  it("does NOT lock at exactly 0 (boundary stays bettable)", () => {
    expect(
      assertBettingAllowed({ balance: 0, stake: 1, maxOverdraft: CAP, lockWhenNegative: ON }),
    ).toEqual({ ok: true });
  });
});

describe("assertBettingAllowed — overdraft cap", () => {
  it("rejects a bet that would breach the cap by one point", () => {
    // balance=10, stake=41 → after = -31, one past -30.
    const r = assertBettingAllowed({
      balance: 10,
      stake: 41,
      maxOverdraft: CAP,
      lockWhenNegative: ON,
    });
    expect(r).toEqual({
      ok: false,
      reason: "overdraft_exceeded",
      balance: 10,
      cap: CAP,
      needed: 1,
    });
  });

  it("reports the deficit when the breach is large", () => {
    // balance=5, stake=100 → after = -95, 65 past -30.
    const r = assertBettingAllowed({
      balance: 5,
      stake: 100,
      maxOverdraft: CAP,
      lockWhenNegative: ON,
    });
    expect(r).toEqual({
      ok: false,
      reason: "overdraft_exceeded",
      balance: 5,
      cap: CAP,
      needed: 65,
    });
  });

  it("cap=0 collapses to the legacy 'balance >= stake' rule", () => {
    // Pre-feature behavior — any negative end-state is rejected.
    expect(
      assertBettingAllowed({ balance: 10, stake: 11, maxOverdraft: 0, lockWhenNegative: ON }),
    ).toEqual({ ok: false, reason: "overdraft_exceeded", balance: 10, cap: 0, needed: 1 });
    expect(
      assertBettingAllowed({ balance: 10, stake: 10, maxOverdraft: 0, lockWhenNegative: ON }),
    ).toEqual({ ok: true });
  });
});

describe("assertBettingAllowed — kill-switch", () => {
  it("with lock off, a negative balance does NOT block placement on its own", () => {
    // -10 balance, +1 stake → after = -11, still within -30 cap → allowed.
    expect(
      assertBettingAllowed({
        balance: -10,
        stake: 1,
        maxOverdraft: CAP,
        lockWhenNegative: OFF,
      }),
    ).toEqual({ ok: true });
  });

  it("with lock off, cap still applies", () => {
    // -20 balance, +15 stake → after = -35, past -30 cap.
    const r = assertBettingAllowed({
      balance: -20,
      stake: 15,
      maxOverdraft: CAP,
      lockWhenNegative: OFF,
    });
    expect(r).toEqual({
      ok: false,
      reason: "overdraft_exceeded",
      balance: -20,
      cap: CAP,
      needed: 5,
    });
  });
});
