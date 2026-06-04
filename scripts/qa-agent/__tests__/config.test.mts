import { afterEach, describe, expect, it } from "vitest";
import {
  assertSandboxHost,
  assertNotProdDb,
  assertSupabaseProjectUrl,
} from "../config.mts";

describe("assertSandboxHost", () => {
  it("accepts the canonical sandbox host", () => {
    expect(() =>
      assertSandboxHost("https://toto-mundial-sandbox.vercel.app", "QA_BASE_URL"),
    ).not.toThrow();
  });

  it("accepts any host that contains 'sandbox'", () => {
    expect(() =>
      assertSandboxHost("https://my-sandbox-preview.vercel.app", "QA_BASE_URL"),
    ).not.toThrow();
  });

  it("refuses the canonical prod host", () => {
    expect(() =>
      assertSandboxHost("https://toto-mundial.vercel.app", "QA_BASE_URL"),
    ).toThrow(/production host/);
  });

  it("refuses the prod kritix domain", () => {
    expect(() =>
      assertSandboxHost("https://toto-mundial.kritix.io", "QA_BASE_URL"),
    ).toThrow(/production host/);
  });

  it("refuses an unknown host that has no 'sandbox' substring", () => {
    expect(() =>
      assertSandboxHost("https://example.com", "QA_BASE_URL"),
    ).toThrow(/not a known sandbox host/);
  });

  it("refuses garbage URLs", () => {
    expect(() => assertSandboxHost("not a url", "QA_BASE_URL")).toThrow(
      /not a valid URL/,
    );
  });
});

describe("assertSupabaseProjectUrl", () => {
  it("accepts a real Supabase project URL", () => {
    expect(() =>
      assertSupabaseProjectUrl(
        "https://abcdefghijklmnop.supabase.co",
        "SANDBOX_SUPABASE_URL",
      ),
    ).not.toThrow();
  });

  it("accepts the older .supabase.in TLD", () => {
    expect(() =>
      assertSupabaseProjectUrl(
        "https://abcdefghijklmnop.supabase.in",
        "SANDBOX_SUPABASE_URL",
      ),
    ).not.toThrow();
  });

  it("refuses a Vercel app URL with a guiding message", () => {
    expect(() =>
      assertSupabaseProjectUrl(
        "https://toto-mundial-sandbox.vercel.app",
        "SANDBOX_SUPABASE_URL",
      ),
    ).toThrow(/Vercel app URL/);
  });

  it("refuses garbage URLs", () => {
    expect(() =>
      assertSupabaseProjectUrl("not a url", "SANDBOX_SUPABASE_URL"),
    ).toThrow(/not a valid URL/);
  });

  it("refuses an arbitrary HTTPS URL", () => {
    expect(() =>
      assertSupabaseProjectUrl(
        "https://example.com",
        "SANDBOX_SUPABASE_URL",
      ),
    ).toThrow(/must be a Supabase project URL/);
  });
});

describe("assertNotProdDb", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("no-ops when PROD_DATABASE_URL is unset", () => {
    delete process.env.PROD_DATABASE_URL;
    delete process.env.PROD_DIRECT_URL;
    expect(() =>
      assertNotProdDb(
        "postgresql://postgres.sbxproj:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
      ),
    ).not.toThrow();
  });

  it("throws when sandbox URL points at the same Supabase project as prod", () => {
    process.env.PROD_DATABASE_URL =
      "postgresql://postgres.PRODPROJ:prodpw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
    expect(() =>
      assertNotProdDb(
        "postgresql://postgres.PRODPROJ:otherpw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
      ),
    ).toThrow(/prod Supabase project/);
  });

  it("does not throw when sandbox and prod are different projects", () => {
    process.env.PROD_DATABASE_URL =
      "postgresql://postgres.PRODPROJ:prodpw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
    expect(() =>
      assertNotProdDb(
        "postgresql://postgres.SBXPROJ:sbxpw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
      ),
    ).not.toThrow();
  });

  it("is case-insensitive on the project segment", () => {
    process.env.PROD_DATABASE_URL =
      "postgresql://postgres.SameProj:prodpw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
    expect(() =>
      assertNotProdDb(
        "postgresql://postgres.sameproj:sbxpw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
      ),
    ).toThrow(/prod Supabase project/);
  });

  it("falls back to PROD_DIRECT_URL when PROD_DATABASE_URL is unset", () => {
    delete process.env.PROD_DATABASE_URL;
    process.env.PROD_DIRECT_URL =
      "postgresql://postgres.PROJX:pw@aws-0.pooler.supabase.com:5432/postgres";
    expect(() =>
      assertNotProdDb(
        "postgresql://postgres.PROJX:differentpw@aws-0.pooler.supabase.com:5432/postgres",
      ),
    ).toThrow(/prod Supabase project/);
  });
});
