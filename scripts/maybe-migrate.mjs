#!/usr/bin/env node
// Prebuild hook: runs DB migrations automatically on Vercel, but stays out
// of the way for local `pnpm build` so a developer doesn't accidentally
// mutate the production schema.
//
// Vercel sets the `VERCEL` env var to `1` in every build environment, so
// we use that as the trigger. Locally devs continue to run
// `pnpm db:migrate` explicitly when they want to apply migrations.

if (!process.env.VERCEL) {
  console.log(
    "[prebuild] local build — skipping db:migrate. Run `pnpm db:migrate` manually if you need it.",
  );
  process.exit(0);
}

if (!process.env.DIRECT_URL) {
  console.error(
    "[prebuild] VERCEL=1 but DIRECT_URL is missing. Add the Supabase direct connection (port 5432) to the Vercel project env vars under Settings → Environment Variables.",
  );
  process.exit(1);
}

console.log("[prebuild] running drizzle migrations against production DB...");
await import("./migrate.mjs");
