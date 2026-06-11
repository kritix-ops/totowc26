import { describe, expect, it } from "vitest";
import { buildAuthConfirmUrl } from "./confirm-url";

describe("buildAuthConfirmUrl", () => {
  it("points at /auth/confirm, not /auth/callback", () => {
    // Regression: an earlier version of this builder pointed at
    // /auth/callback, which verifyOtp'd on GET. Link-preview crawlers
    // (WhatsApp, iMessage, Gmail) burned the single-use Supabase token
    // before the human ever clicked and every shared link rendered as
    // "expired". The confirm page only verifies on a button-press POST.
    const url = buildAuthConfirmUrl({
      origin: "https://example.com",
      hashedToken: "abc123",
      type: "recovery",
      next: "/he/set-password",
    });
    expect(url).toContain("/auth/confirm");
    expect(url).not.toContain("/auth/callback");
  });

  it("round-trips token_hash, type and next as query params", () => {
    const url = new URL(
      buildAuthConfirmUrl({
        origin: "https://example.com",
        hashedToken: "abc123",
        type: "invite",
        next: "/he/set-password",
      }),
    );
    expect(url.searchParams.get("token_hash")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("invite");
    expect(url.searchParams.get("next")).toBe("/he/set-password");
  });

  it("escapes a next that contains query params", () => {
    const url = new URL(
      buildAuthConfirmUrl({
        origin: "https://example.com",
        hashedToken: "abc123",
        type: "magiclink",
        next: "/he/onboarding?from=invite&utm=admin",
      }),
    );
    expect(url.searchParams.get("next")).toBe(
      "/he/onboarding?from=invite&utm=admin",
    );
  });
});
