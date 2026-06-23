// Prompt construction for the LLM live-bet generator. Pure module (no
// server-only, no SDK, no IO) so generate.ts AND an offline harness/test can
// build the EXACT same system + user prompts — the prompt is the product, so
// it must have a single source of truth.
//
// Split out of generate.ts so the prompt text can be exercised without the
// server-only transport. See
// _plans/2026-06-23-live-bet-distribution-and-day-aggregation.md.

// Scope-aware generation context. Today's surfaces are `match` (one fixture)
// and `day` (a whole matchday), but the shape is deliberately open so
// tournament/stage/group generation can slot in later without reworking the
// generator. The scope drives the prompt header + the grading note; the
// actual dossier text + valid player ids ride in GenerateOptions.
//
// See _plans/2026-06-13-live-bet-suggestions-enrichment.md (clarification 5).
export type GenerationScope = "match" | "day" | "tournament" | "stage" | "group";

export type GenerationContext = {
  scope: GenerationScope;
  // One-line description of what we're generating for, rendered at the top
  // of the user prompt, e.g. "Argentina (HE: ארגנטינה) vs Mexico ..." or
  // "All matches on Sat 14 Jun (Asia/Jerusalem)".
  label: string;
};

export type GenerateOptions = {
  // How many bets to ask for (clamped 2..10). Default 6.
  count?: number;
  // Free-text admin steer appended to the prompt, e.g. "focus on cards and
  // corners" or "no VAR bets". Untrusted text — it can only influence the
  // wording/selection, never bypass the schema validation downstream.
  instructions?: string;
  // Rendered match dossier (src/lib/bets/suggest/dossier.ts). The whole
  // point of the overhaul: without it the model has nothing fixture-specific
  // to say and regresses to generic markets.
  dossierText?: string;
  // Every valid API-Football player id for this fixture. Any player-prop the
  // model emits with an id outside this set has its grading nulled (manual)
  // so a hallucinated id can never reach the auto grader.
  validPlayerIds?: Set<number>;
  // Questions already live/drafted for this fixture, so the model does not
  // re-propose them — the anti-repetition lever the user asked for.
  existingQuestions?: string[];
  // How many web searches the model may run before emitting (0 = off, the
  // forced-tool single shot). Clamped to 0..3. The user chose focused search.
  webSearchMaxUses?: number;
};

// The settlement vocabulary the model may target. Anything outside this set
// must be `grading: null` (manual). Kept in sync with the auto sources the
// system can actually evaluate today (src/lib/bets/types.ts + the grader).
const AUTO_FOOTBALL_DATA_FIELDS = [
  "winner", "total_goals", "ht_total", "second_half_total", "home_score",
  "away_score", "winning_margin", "went_to_penalties", "btts", "home_scored",
  "away_scored", "clean_sheet_home", "clean_sheet_away", "first_half_goal",
  "second_half_goal", "both_halves_scored", "over_0_5_goals", "over_1_5_goals",
  "over_2_5_goals", "over_3_5_goals", "over_4_5_goals",
];
const AUTO_API_FOOTBALL_STATS = [
  "corners", "yellow_cards", "red_cards", "shots", "shots_on_goal",
  "shots_inside_box", "shots_outside_box", "possession", "fouls", "offsides",
  "saves", "total_passes", "pass_accuracy",
];

export function buildSystemPrompt(scope: GenerationScope): string {
  const subject = scope === "match" ? "this exact fixture" : "these fixtures";
  return [
    "You design live in-play betting markets for a private World Cup pool played between friends.",
    scope === "match"
      ? "You are generating markets for ONE fixture."
      : "You are generating DAY-WIDE markets that aggregate across ALL of the day's fixtures combined (total goals on the whole day, total yellow cards across every game, total corners across the day). Never write a market about a single fixture — a market that is really about one game belongs at match scope, not here. Every market you emit here counts across the entire slate of fixtures in the dossier.",
    `You are given a DOSSIER of real data for ${subject} (form, injuries, key players with ids, the model's win probabilities, recent results). Treat it as a toolbox, not a checklist: read it, judge what actually fits, and build markets around what you find. The goal is bets that could only have been written for ${subject}, not generic ones that would fit any game unless the dossier gives a concrete reason to feature them.`,
    "Return a batch of varied bets via the tool.",
    "",
    scope === "match" ? matchCapabilities() : dayCapabilities(),
    "",
    "Hard rules:",
    "- Every bet has Hebrew AND English question + grading rule. No em dashes anywhere.",
    "- Give each outcome a calibrated PROBABILITY (0..1). For multi_choice the options are mutually exclusive and their probabilities should roughly sum to 1. Be realistic and use the dossier: a likely outcome gets a high probability so it pays little. Do not flatten probabilities into a fake spread, and do not make a star striker's 'to score' a coin flip when the data says otherwise.",
    "- Prefer ONE grouped multi_choice DISTRIBUTION over several yes/no bets when outcomes are related. A distribution with 4-7 options is more interesting than a 50/50 yes/no: the probability spreads, so each option pays more. Lead the batch with distributions; keep flat yes/no markets a minority.",
    "- A multi_choice market whose options are NUMERIC RANGES of a derivable quantity (total goals 0-1 / 2-3 / 4+, total corners, total cards, winning margin) MUST set grading to the matching auto source so it self-grades — the system maps the measured number to the option whose range contains it. Keep each option's `value` a plain range token ('0-1', '2-3', '4+') so the mapping is unambiguous; never sign-prefix it ('+4'). Make the ranges a clean partition with no gaps or overlaps.",
    "- Set grading to an auto source ONLY when the outcome is fully derivable from the feeds below; otherwise grading must be null (manual).",
    `  auto_football_data fields (final score / halves): ${AUTO_FOOTBALL_DATA_FIELDS.join(", ")}.`,
    scope === "match"
      ? `  auto_api_football stats (per-match team totals — corners/cards/shots/offsides/fouls counts): { source:'auto_api_football', stat, aggregate:'per_match' }. stat ∈ ${AUTO_API_FOOTBALL_STATS.join(", ")}.`
      : `  auto_api_football stats SUMMED ACROSS THE DAY: { source:'auto_api_football', stat, aggregate:'sum_day' }. stat ∈ ${AUTO_API_FOOTBALL_STATS.join(", ")}. Use sum_day for every day-wide count market (total corners on the day, total yellows on the day, total offsides on the day).`,
    "  auto_api_football events (timeline, yes/no bets ONLY): { source:'auto_api_football', events:{ metric, window, op, value, team?, playerApiId?, byAssist? } }.",
    "    metric ∈ red_card|yellow_card|card|goal|penalty|substitution. window ∈ '1H'|'2H'|'FT' or {fromMinute,toMinute}. op ∈ >=|>|=|<=|<. team ∈ home|away|any (default any).",
    "    Use this for markets like 'red card in the first half?' (metric red_card, window 1H, op >=, value 1) or 'goal in the opening 15 minutes?' ({fromMinute:1,toMinute:15}).",
    "  auto_api_football FIRST-EVENT-WINDOW (multi_choice DISTRIBUTION, the juiciest shape): 'which window does the FIRST goal/card/substitution fall in?'. answerType MUST be multi_choice. Options are consecutive clock-minute ranges as plain tokens ('1-15','16-30','31-45','46-60','61-75','76-90') PLUS exactly one non-numeric 'no event' bucket (value like 'none', label 'אין שער'/'no goal'). grading: { source:'auto_api_football', firstEventWindow:{ metric, team?, playerApiId? } }. metric ∈ goal|yellow_card|red_card|card|penalty|substitution. The system buckets the first matching event's minute onto the option; if it never happens the 'no event' option wins. Use metric 'goal' for first-goal timing, 'substitution' for the first-sub window. Word it as a 15-MINUTE WINDOW, not a half, and the SAME event must appear in both languages and the metric (Hebrew 'באיזה חלון של 15 דקות ייפול השער הראשון?' for goal, 'הכרטיס הראשון' for card, 'החילוף הראשון' for substitution). Never say 'מחצית' (half) or name a different event (e.g. 'קרן'/corner) than the metric.",
    "  auto_api_football COMEBACK (yes_no only): { source:'auto_api_football', comeback:{ team? } }. Resolves yes when the full-time winner trailed on the scoreboard at some point. team ∈ home|away|any (default any; set it for 'will TEAM come back to win?'). Match scope only.",
    "  PLAYER markets auto-grade via events: set playerApiId = the player's id FROM THE DOSSIER (never invent an id). 'X to score' -> events metric goal, window FT, op >=, value 1, playerApiId. 'X to assist' -> same plus byAssist:true. 'X to be booked' -> metric yellow_card (or card), window FT, op >=, value 1, playerApiId. Player events markets must be yes_no.",
    "- Only reference a player id that appears in the dossier. If you want a player market for someone not listed, set grading null (manual) instead of guessing an id.",
    "- VAR markets have NO reliable auto source — always leave their grading null (manual).",
    "- The grading rule must be unambiguous and match the grading source/spec exactly.",
    "- rationale: one short sentence on why the probabilities are calibrated that way, citing the dossier where relevant.",
    "",
    hebrewRegisterBlock(),
  ].join("\n");
}

// Match-scope capability menu. Distribution markets lead — they are the
// bets the pool finds most engaging (many options, real spread, each pays
// more) and they all self-grade — with player props and flat yes/no as
// supporting variety rather than the bulk.
function matchCapabilities(): string {
  return [
    "Capabilities (use the ones that fit, skip the rest). LEAD with distributions:",
    "- COUNT DISTRIBUTIONS (multi_choice, your backbone): total corners, total yellow cards, total shots on target, total offsides, total fouls, total goals, or winning margin — each as 3-5 mutually exclusive range buckets. They all auto-grade. Pick buckets that actually split the probability for THIS matchup (a cagey game's corner buckets sit lower than an open one's).",
    "- FIRST-EVENT-WINDOW DISTRIBUTIONS (multi_choice): which 15-minute window the first goal / first card / first substitution falls in, plus a 'no event' bucket. High-engagement, auto-graded (see firstEventWindow below).",
    "- Player markets keyed to a real dossier player (to score, to score or assist, to be booked) when there is a standout worth featuring. A scrappy game with no big names does not need forced star props.",
    "- Team angles: a side that concedes / keeps clean sheets a lot -> clean-sheet or both-teams-to-score; the projected scoreline -> a winning-margin or first-goal-window market.",
    "- COMEBACK markets (yes_no): 'will a team come back from behind to win?' (or 'will TEAM come back to win?'). High drama, auto-graded (see comeback below). Reach for these when the dossier suggests a close, swingy game.",
    "- A few sharp yes/no event markets (red card in a half, goal in the opening 15, a substitution before the hour) for flavor — keep them the minority.",
    "Vary the shapes across the batch and never repeat an idea. YOU decide the mix that fits this specific fixture; nothing here is mandatory, but a batch that is all flat yes/no bets is a failure.",
  ].join("\n");
}

// Day-scope capability menu. Everything aggregates across the whole slate;
// per-fixture markets are explicitly out of scope here.
function dayCapabilities(): string {
  return [
    "Capabilities (every market aggregates across ALL the day's fixtures — never a single game):",
    "- DAY-WIDE COUNT DISTRIBUTIONS (multi_choice, your backbone): total goals across all of today's matches, total yellow cards on the day, total red cards, total corners, total offsides, total shots on target — each as 3-5 mutually exclusive range buckets sized to the number of fixtures in the dossier. These self-grade (total goals via auto_football_data total_goals; the rest via auto_api_football stat with aggregate sum_day).",
    "- The ONLY day-wide auto sources are auto_football_data total_goals/ht_total and auto_api_football stats with aggregate sum_day. Match-only sources (events, firstEventWindow, comeback, per_match/first_match stats) do NOT grade at day scope — a day bet using them settles MANUALLY. So make day bets distributions/numbers off a day-wide source; only write a day yes/no if you accept manual grading, and keep its wording unambiguous (say 'somewhere today / across the day', never 'in each match').",
    "- Avoid single-player props at day scope: one player's tally cannot be aggregated cleanly across the slate. Keep the focus on day-wide totals.",
    "Vary the buckets and the stats across the batch; never repeat the same total twice. Size every range to the actual number of fixtures today.",
  ].join("\n");
}

// Hebrew quality is a first-class requirement, not a translation afterthought.
// The pool is Israeli and reads these on their phones; translated-sounding
// Hebrew is exactly what the user flagged. Give the model register, a small
// glossary, and contrasting examples so the output reads like a friend wrote
// it, not like a localized bookmaker.
function hebrewRegisterBlock(): string {
  return [
    "Hebrew quality (critical):",
    "- Write the Hebrew like an Israeli football fan texting friends, casual and natural, NOT like a translated betting slip. It should never read as if run through a translator.",
    "- Use the natural Hebrew football register. Glossary: שער (goal), בישול/אסיסט (assist), כרטיס צהוב/אדום (yellow/red card), פנדל (penalty), קרן (corner), הפסקה/מחצית ראשונה/שנייה (half-time / first / second half), ניצחון/תיקו/הפסד (win/draw/loss), שער נקי (clean sheet), שתי הקבוצות יבקיעו (both teams to score).",
    "- Phrase player markets with the player's Hebrew name naturally, e.g. 'מסי יבקיע במשחק?' not 'האם השחקן ליאו מסי ירשום הבקעה'.",
    "- Numbers and ranges read right in Hebrew: 'יותר מ-2.5 שערים', 'השער הראשון ייפול ב-15 הדקות הראשונות'.",
    "- Examples. Natural: 'יבקיע אמבפה בכל זמן שהוא?' / 'יותר מ-9 קרנות במשחק?' / 'מי יבקיע ראשון, צרפת או אנגליה?'. Translated-sounding (AVOID): 'האם מבאפה יבצע הבקעה?' / 'מעל תשע קרניות בהתמודדות' / 'איזו נבחרת תשיג את ההבקעה הראשונה'.",
  ].join("\n");
}

export function buildUserPrompt(
  context: GenerationContext,
  count: number,
  opts?: GenerateOptions,
): string {
  const subjectWord = context.scope === "match" ? "fixture" : "matchday";
  const lines = [`${context.scope === "match" ? "Fixture" : "Matchday"}: ${context.label}`];

  const dossier = opts?.dossierText?.trim();
  if (dossier) {
    lines.push("", `=== DOSSIER (real data for this ${subjectWord}) ===`, dossier, "=== END DOSSIER ===");
  } else {
    lines.push("", `(No dossier available for this ${subjectWord} — fall back to general knowledge, but stay specific to the teams involved.)`);
  }

  const existing = (opts?.existingQuestions ?? [])
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 25);
  if (existing.length > 0) {
    lines.push(
      "",
      `Bets ALREADY live for this ${subjectWord} — do NOT repeat these or trivial rewordings of them:`,
      ...existing.map((q) => `- ${q}`),
    );
  }

  lines.push(
    "",
    context.scope === "match"
      ? `Produce about ${count} bets now, each specific to this fixture. Lead with multi_choice distribution markets; keep flat yes/no a minority.`
      : `Produce about ${count} day-wide bets now. Each one MUST aggregate across ALL of today's matches combined (e.g. total goals / yellows / corners across the whole slate), never about a single fixture, and should self-grade via total_goals or a sum_day stat.`,
  );

  const steer = opts?.instructions?.trim();
  if (steer) {
    // Fence the admin's request so the model treats it as guidance, not as
    // instructions that could override the hard rules above.
    lines.push("", "Admin request (follow within the hard rules above):", steer.slice(0, 600));
  }
  return lines.join("\n");
}
