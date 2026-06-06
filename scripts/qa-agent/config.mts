// Central config for the QA agent. Every other module imports from
// here so env-handling, safety guards, and tunable thresholds live in
// exactly one place.

export const MODEL = "claude-sonnet-4-6";

// Anthropic pricing as of 2026-06-04 (Sonnet 4.6).
export const PRICE_PER_MTOK_INPUT_USD = 3;
export const PRICE_PER_MTOK_OUTPUT_USD = 15;
export const PRICE_PER_MTOK_CACHE_READ_USD = 0.3;
export const PRICE_PER_MTOK_CACHE_WRITE_USD = 3.75;

// Hard cap. If a run's spend crosses this, the loop aborts and the
// reporter writes a partial report. With prompt caching the typical
// 9-scenario `pnpm qa-agent all` lands around $3.00; the cap is set
// at $5.00 so a full sweep + headroom + the rare retry can run to
// completion. A single-scenario run will not get anywhere near this.
export const BUDGET_USD_HARD_CAP = 5.0;

// Maximum tool-use turns per scenario. Backstop in case the model
// gets stuck retrying the same step.
export const MAX_TURNS_PER_SCENARIO = 60;

// Report retention. Keep last N runs no matter what + ALL runs that
// contain at least one `critical` finding (up to CRITICAL_CAP as a
// final backstop so a long bad streak does not fill the disk).
export const KEEP_LAST_N_RUNS = 20;
export const KEEP_CRITICAL_CAP = 100;

// Viewports the RTL/mobile scenario sweeps. Matches the verification
// checklist in CLAUDE.md.
export const VIEWPORTS: ReadonlyArray<{ name: string; width: number; height: number }> = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "mobile-414", width: 414, height: 896 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

// Hostnames the agent is allowed to drive. Anything else and the
// runner refuses to start. The agent is a sandbox-only tool by
// construction; production traffic comes from humans.
const ALLOWED_HOSTS = ["toto-mundial-sandbox.vercel.app"];

// Hostnames we refuse outright, even if QA_BASE_URL is misread. Belt
// and suspenders.
const FORBIDDEN_HOSTS = [
  "toto-mundial.vercel.app",
  "toto-mundial.kritix.io",
  "toto.kritix.io",
];

export type AgentEnv = {
  baseUrl: string;
  qaBotEmail: string;
  qaBotPassword: string;
  anthropicApiKey: string;
};

export type SeedEnv = {
  sandboxSupabaseUrl: string;
  sandboxServiceRoleKey: string;
  sandboxDirectUrl: string;
  qaBotEmail: string;
  qaBotPassword: string;
};

export const QA_BOT_EMAIL = "qa-bot@kritix.io";
export const QA_BOT_DISPLAY_NAME = "QA Bot";

export function readAgentEnv(): AgentEnv {
  const baseUrl = required("QA_BASE_URL");
  assertSandboxHost(baseUrl, "QA_BASE_URL");
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    qaBotEmail: process.env.QA_BOT_EMAIL ?? QA_BOT_EMAIL,
    qaBotPassword: required("QA_BOT_PASSWORD"),
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
  };
}

export function readSeedEnv(): SeedEnv {
  const url = required("SANDBOX_SUPABASE_URL");
  assertSupabaseProjectUrl(url, "SANDBOX_SUPABASE_URL");
  const direct = required("SANDBOX_DIRECT_URL");
  assertNotProdDb(direct);
  return {
    sandboxSupabaseUrl: url,
    sandboxServiceRoleKey: required("SANDBOX_SUPABASE_SERVICE_ROLE_KEY"),
    sandboxDirectUrl: direct,
    qaBotEmail: process.env.QA_BOT_EMAIL ?? QA_BOT_EMAIL,
    qaBotPassword: required("QA_BOT_PASSWORD"),
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`[qa.boot] missing required env var: ${name}`);
  }
  return v;
}

// Exported for unit tests.
export function assertSandboxHost(value: string, varName: string): void {
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    throw new Error(`[qa.boot] ${varName} is not a valid URL: ${value}`);
  }
  if (FORBIDDEN_HOSTS.includes(host)) {
    throw new Error(
      `[qa.boot] ${varName} points at a production host (${host}). QA agent refuses to run.`,
    );
  }
  const isExplicitlyAllowed = ALLOWED_HOSTS.includes(host);
  const containsSandbox = host.includes("sandbox");
  if (!isExplicitlyAllowed && !containsSandbox) {
    throw new Error(
      `[qa.boot] ${varName} host "${host}" is not a known sandbox host. ` +
        `Allowed: ${ALLOWED_HOSTS.join(", ")} or any host containing "sandbox".`,
    );
  }
}

// Catches the easy mistake of pasting the sandbox WEBSITE URL
// (toto-mundial-sandbox.vercel.app) instead of the SUPABASE project
// URL (...supabase.co). The seed script calls Supabase REST, so a
// website URL returns HTML and triggers a useless JSON-parse error
// downstream. This check converts it into a useful boot-time message.
// Exported for unit tests.
export function assertSupabaseProjectUrl(value: string, varName: string): void {
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    throw new Error(`[qa.boot] ${varName} is not a valid URL: ${value}`);
  }
  if (!host.endsWith(".supabase.co") && !host.endsWith(".supabase.in")) {
    throw new Error(
      `[qa.boot] ${varName} must be a Supabase project URL ending in ` +
        `.supabase.co (got "${host}"). Find it in your Supabase dashboard ` +
        `→ Project Settings → Data API → Project URL. ` +
        `Do not paste the Vercel app URL here - that goes in QA_BASE_URL.`,
    );
  }
}

// Exported for unit tests.
export function assertNotProdDb(directUrl: string): void {
  const prod = process.env.PROD_DATABASE_URL ?? process.env.PROD_DIRECT_URL;
  if (!prod) return;
  // Compare by host+project segment so a password change does not
  // create a false negative. Postgres URLs from Supabase look like
  // postgresql://postgres.<project>:<pw>@aws-0-<region>.pooler...
  const sandboxProject = extractSupabaseProject(directUrl);
  const prodProject = extractSupabaseProject(prod);
  if (sandboxProject && prodProject && sandboxProject === prodProject) {
    throw new Error(
      `[qa.boot] SANDBOX_DIRECT_URL resolves to the prod Supabase project ` +
        `(${prodProject}). Seed script refuses to run.`,
    );
  }
}

function extractSupabaseProject(pgUrl: string): string | null {
  // postgres.<project>:<pw>@<host>
  const m = pgUrl.match(/postgres\.([a-z0-9]+):/i);
  return m ? m[1].toLowerCase() : null;
}
