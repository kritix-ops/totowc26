import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runLiveAutogen } from "@/lib/bets/suggest/autogen";

// One AI generation is ~30s; the runner budgets its wall-clock and defers
// the overflow, but it still needs the full function ceiling to finish a
// match or two. Matches the 60s the other cron routes use.
export const maxDuration = 60;

// Daily cron that seeds draft AI live-bet suggestions for upcoming matches
// when the admin has enabled the rule (settings.live_autogen_enabled). The
// generator queues DRAFTS only — the admin still reviews and publishes in
// /admin/bets. No-ops cheaply when the rule is off or nothing is eligible.
// See _plans/2026-06-12-live-bets-llm-overhaul.md Phase 3 (rules engine).

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const report = await runLiveAutogen();
    return NextResponse.json({ ok: true, report, ms: Date.now() - startedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[live-autogen failed]", { err, ms: Date.now() - startedAt });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const POST = GET;
