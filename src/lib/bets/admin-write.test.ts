import { describe, expect, it } from "vitest";
import { assertAdminReason } from "./write-core";

// Unit tests for the pure-function guards in the admin proxy write
// path. DB-side behavior (audit atomicity, bank refund, lock bypass) is
// covered by the manual QA checklist in
// _plans/2026-06-08-admin-bet-inspector.md — those require a real DB
// and live outside the source-level test harness.

describe("assertAdminReason", () => {
  it("accepts a normal reason", () => {
    expect(() => assertAdminReason("Filled in for Oded over the phone")).not.toThrow();
  });

  it("accepts a short single-word reason", () => {
    expect(() => assertAdminReason("typo")).not.toThrow();
  });

  it("accepts Hebrew text", () => {
    expect(() => assertAdminReason("השלמתי טלפונית")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => assertAdminReason("")).toThrow(/non-empty reason/);
  });

  it("rejects whitespace-only", () => {
    expect(() => assertAdminReason("   ")).toThrow(/non-empty reason/);
    expect(() => assertAdminReason("\t\n  ")).toThrow(/non-empty reason/);
  });

  it("rejects non-string types", () => {
    // The DB CHECK is the second line of defense; this guard catches the
    // happy-path bug where a JS caller forgot to pass the field.
    expect(() =>
      assertAdminReason(undefined as unknown as string),
    ).toThrow(/non-empty reason/);
    expect(() => assertAdminReason(null as unknown as string)).toThrow(
      /non-empty reason/,
    );
    expect(() => assertAdminReason(0 as unknown as string)).toThrow(
      /non-empty reason/,
    );
  });
});
