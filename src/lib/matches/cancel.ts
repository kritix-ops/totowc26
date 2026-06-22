// Pure, DB-free logic for resolving a canceled match's 1/X/2 guesses.
// Kept free of any db/server imports so it is unit-testable in isolation and
// safe to import from both the Drizzle schema (type only) and the scoring
// path. See _plans/2026-06-22-match-cancel-postpone-admin.md.

export type CancelResolution = "void" | "awarded" | "split";

// Shape stored in matches.cancel_resolution_config (jsonb). Discriminated by
// `kind` so a row is self-describing without cross-referencing the enum.
//   void    - no extra data.
//   awarded - the technical scoreline guesses are graded against.
//   split   - the flat points every picker receives.
export type CancelResolutionConfig =
  | { kind: "void" }
  | { kind: "awarded"; home: number; away: number }
  | { kind: "split"; points: number }
  | null;

export type GuessGrade = {
  points: number;
  wasExact: boolean;
  wasCorrectOutcome: boolean;
};

// 1/X/2 direction of a scoreline. Mirrors outcome() in sync.ts.
export function outcome(home: number, away: number): "1" | "X" | "2" {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

// Validate an admin-supplied resolution + config pair before it is persisted.
// Returns null when valid, otherwise a short machine-readable error code.
// Fail-closed: anything not explicitly allowed is rejected.
export function validateCancelResolution(
  resolution: CancelResolution,
  config: CancelResolutionConfig,
): null | "invalid_resolution" | "invalid_awarded_score" | "invalid_split_points" {
  if (resolution === "void") {
    return config === null || config.kind === "void" ? null : "invalid_resolution";
  }
  if (resolution === "awarded") {
    if (!config || config.kind !== "awarded") return "invalid_awarded_score";
    if (!isScore(config.home) || !isScore(config.away)) {
      return "invalid_awarded_score";
    }
    return null;
  }
  if (resolution === "split") {
    if (!config || config.kind !== "split") return "invalid_split_points";
    if (!Number.isInteger(config.points) || config.points < 0 || config.points > 1000) {
      return "invalid_split_points";
    }
    return null;
  }
  return "invalid_resolution";
}

// Grade a single 1/X/2 guess for a canceled match. The risk-mode penalty is
// NEVER applied here: a cancellation is not something a player could predict,
// so a wrong guess earns 0, never a negative. (Confirmed product decision.)
export function gradeCanceledGuess(args: {
  resolution: CancelResolution;
  config: CancelResolutionConfig;
  guessHome: number;
  guessAway: number;
  scoringExact: number;
  scoringOutcome: number;
}): GuessGrade {
  const { resolution, config, guessHome, guessAway, scoringExact, scoringOutcome } = args;

  if (resolution === "void") {
    return { points: 0, wasExact: false, wasCorrectOutcome: false };
  }

  if (resolution === "split") {
    const points = config && config.kind === "split" ? config.points : 0;
    return { points, wasExact: false, wasCorrectOutcome: false };
  }

  // awarded: grade against the technical scoreline, no penalty for a miss.
  if (config && config.kind === "awarded") {
    const exact = guessHome === config.home && guessAway === config.away;
    const correctOutcome = outcome(guessHome, guessAway) === outcome(config.home, config.away);
    const points = exact ? scoringExact : correctOutcome ? scoringOutcome : 0;
    return { points, wasExact: exact, wasCorrectOutcome: correctOutcome };
  }

  // Defensive fallback: an awarded resolution with a malformed config is
  // treated as neutral rather than throwing inside the scoring loop.
  return { points: 0, wasExact: false, wasCorrectOutcome: false };
}

function isScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 99;
}
