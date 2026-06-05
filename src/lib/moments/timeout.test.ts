import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./timeout";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves to the underlying value when it settles before the deadline", async () => {
    const p = Promise.resolve(42);
    await expect(withTimeout(p, 100, "fast", -1)).resolves.toBe(42);
  });

  it("resolves to the fallback when the underlying promise never settles", async () => {
    const result = withTimeout(new Promise<number>(() => {}), 100, "stuck", -1);
    await vi.advanceTimersByTimeAsync(101);
    await expect(result).resolves.toBe(-1);
  });

  it("resolves to the fallback when the underlying promise rejects", async () => {
    const p = Promise.reject(new Error("boom"));
    await expect(withTimeout(p, 100, "broken", -1)).resolves.toBe(-1);
  });

  it("does not fire the timeout once the underlying promise has settled", async () => {
    const result = withTimeout(Promise.resolve(7), 100, "fast", -1);
    await expect(result).resolves.toBe(7);
    // Advancing the fake clock past the timeout MUST be a no-op now -
    // any leftover timer would log a warning we never want to see.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(200);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
