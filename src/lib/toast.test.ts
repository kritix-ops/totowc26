import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, getToasts, dismissToast, subscribe } from "./toast";

// The toast store is a module singleton, so each test clears it and resets
// timers to keep state from leaking between cases.
function clearAll() {
  for (const t of [...getToasts()]) dismissToast(t.id);
}

beforeEach(() => {
  vi.useFakeTimers();
  clearAll();
});

afterEach(() => {
  clearAll();
  vi.useRealTimers();
});

describe("toast store", () => {
  it("adds a toast and exposes it via getToasts", () => {
    toast.success("נשמר");
    const toasts = getToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: "success", message: "נשמר" });
  });

  it("notifies subscribers on change and on dismiss", () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    const id = toast.info("hi");
    expect(listener).toHaveBeenCalledTimes(1);
    dismissToast(id);
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    toast.info("again");
    // No further calls after unsubscribe.
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("auto-dismisses success after its default duration", () => {
    toast.success("נשמר");
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(2999);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it("keeps error toasts sticky (no auto-dismiss)", () => {
    toast.error("נכשל");
    vi.advanceTimersByTime(60_000);
    expect(getToasts()).toHaveLength(1);
  });

  it("honors a custom duration override, including making an error expire", () => {
    toast.error("temporary", { duration: 1000 });
    vi.advanceTimersByTime(1000);
    expect(getToasts()).toHaveLength(0);
  });

  it("caps the stack at 3, dropping the oldest", () => {
    const a = toast.info("a");
    toast.info("b");
    toast.info("c");
    toast.info("d");
    const toasts = getToasts();
    expect(toasts).toHaveLength(3);
    expect(toasts.map((t) => t.message)).toEqual(["b", "c", "d"]);
    // The dropped toast's id is gone.
    expect(toasts.some((t) => t.id === a)).toBe(false);
  });

  it("returns a stable array reference until the next mutation", () => {
    toast.info("x");
    const first = getToasts();
    expect(getToasts()).toBe(first); // no change → same reference
    toast.info("y");
    expect(getToasts()).not.toBe(first); // mutation → new reference
  });

  it("dismiss is idempotent and ignores unknown ids", () => {
    const id = toast.info("x");
    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
    // Dismissing again, or an unknown id, does nothing and doesn't throw.
    expect(() => dismissToast(id)).not.toThrow();
    expect(() => dismissToast(999_999)).not.toThrow();
  });
});
