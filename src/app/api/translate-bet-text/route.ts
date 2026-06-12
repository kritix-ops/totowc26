import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/auth";

// POST /api/translate-bet-text
//
// Translates short Hebrew bet/duel copy into natural sporting English.
// Used by the auto-translate hook (`useAutoTranslate`) wired into the
// new-duel form and the admin custom-bet form so the opener/admin
// doesn't have to type both copies for every prop.
//
// Why a route handler: the form fires this on input blur, possibly N
// times per save (question + rule + N option labels). Server actions
// serialise per-tab and would stall the typing experience. Route
// handlers dispatch in parallel.
//
// Auth: any logged-in user; the form surfaces are already gated to
// admin (custom bets) or paid user (duels), but we re-check at the
// boundary so a tampered fetch can't free-call the Anthropic SDK.
//
// Rate limit: 30 calls / 5 min per user via an in-process map. The
// friends-pool scale lives on a single Vercel region so the map is
// effectively global; if we ever scale out the limit will be soft per
// region which is still well inside the Claude price band.
//
// Cost reference (per CLAUDE.md rule 8): Claude Haiku 4.5 sits at
// ~$0.80/M input + $4/M output tokens (per models.dev, verified
// 2026-06-12). A bet/duel translation is ~80 input + ~40 output, so
// ~$0.0002 per call. A whole tournament of editing rounds is dollars.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_INPUT_CHARS = 400;
const TIMEOUT_MS = 8_000;

type TranslateResult =
  | { ok: true; translation: string }
  | { ok: false; error: "unauth" | "invalid" | "rate_limited" | "no_key" | "api_error" };

type RateBucket = { count: number; resetAt: number };
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 30;
const rateBuckets = new Map<string, RateBucket>();

function checkRate(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

const CONTEXT_HINTS: Record<string, string> = {
  question: "It's a short betting question asked of a friends pool.",
  rule: "It's the unambiguous grading rule for a friends-pool bet.",
  option: "It's a short option label that appears in a 2-5 button picker.",
};

function buildSystemPrompt(context: string | undefined): string {
  const hint = context && CONTEXT_HINTS[context] ? CONTEXT_HINTS[context] : "";
  return [
    "You translate Hebrew sports-betting copy into natural English.",
    hint,
    "Rules:",
    "- Output ONLY the English translation. No quotes, no preamble, no explanation.",
    "- Match the register and length of the input. A short question stays a short question.",
    "- Use natural sporting English, not literal word-for-word.",
    "- No em dashes, no smart quotes, no flourishes.",
    "- Keep team and player names as they appear in mainstream English coverage.",
    "- If the input is already English, return it unchanged.",
  ].join("\n");
}

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
};

export async function POST(
  request: NextRequest,
): Promise<NextResponse<TranslateResult>> {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauth" }, { status: 401 });
  }

  let payload: { text?: unknown; context?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const context = typeof payload.context === "string" ? payload.context : undefined;
  if (text.length === 0 || text.length > MAX_INPUT_CHARS) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  if (!checkRate(user.id)) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429 },
    );
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.warn("[translate-bet-text stubbed]", { reason: "ANTHROPIC_API_KEY not set" });
    return NextResponse.json({ ok: false, error: "no_key" }, { status: 503 });
  }

  const started = Date.now();
  let json: AnthropicResponse;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        system: buildSystemPrompt(context),
        messages: [{ role: "user", content: text }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[translate-bet-text api_error]", {
        status: res.status,
        body: body.slice(0, 300),
      });
      return NextResponse.json({ ok: false, error: "api_error" }, { status: 502 });
    }
    json = (await res.json()) as AnthropicResponse;
  } catch (err) {
    console.error("[translate-bet-text fetch_failed]", { err });
    return NextResponse.json({ ok: false, error: "api_error" }, { status: 502 });
  }

  const translation =
    json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
  if (translation.length === 0) {
    console.warn("[translate-bet-text empty]", { textLen: text.length });
    return NextResponse.json({ ok: false, error: "api_error" }, { status: 502 });
  }

  console.info("[translate-bet-text]", {
    userId: user.id,
    context: context ?? null,
    textLen: text.length,
    translationLen: translation.length,
    ms: Date.now() - started,
  });

  return NextResponse.json({ ok: true, translation });
}
