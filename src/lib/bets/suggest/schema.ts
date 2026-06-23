// The contract the LLM must produce for a live-bet suggestion, plus the
// JSON Schema handed to the Anthropic Messages API as a forced tool so the
// model returns validated structured data instead of prose. Pure module
// (no server-only, no SDK) so the transform + tests can import it freely.
//
// Design notes:
//   - The model returns a PROBABILITY per outcome, never odds. Pricing is
//     derived in code (src/lib/bets/price-options.ts) so a likely outcome
//     can't be mispriced as a longshot — the whole point of Phase 1.
//   - Grading reuses the existing GradingConfig union. The model may only
//     pick a settlement source the system can actually evaluate today
//     (final-score fields or API-Football team stats) or `manual`. Exotic
//     event markets (VAR, red-in-half) stay manual until Phase 3 wires the
//     events settlement source. See
//     _plans/2026-06-12-live-bets-llm-overhaul.md.

import type { GradingConfig } from "@/lib/bets/types";

export type SuggestedAnswerType = "yes_no" | "multi_choice";

export type SuggestedOption = {
  // Stable key stored in answer_config and matched against the pick.
  value: string;
  labelHe: string;
  labelEn: string;
  // 0..1. The vector is renormalised in code, so the model's estimates
  // need not sum to exactly 1.
  probability: number;
};

export type LiveBetSuggestion = {
  questionHe: string;
  questionEn: string;
  answerType: SuggestedAnswerType;
  // Present for multi_choice (2..8 mutually-exclusive outcomes).
  options?: SuggestedOption[];
  // Present for yes_no: probability the answer is "yes".
  yesProbability?: number;
  gradingRuleHe: string;
  gradingRuleEn: string;
  // Settlement source. null = manual grading by the admin.
  grading: GradingConfig;
  // One sentence on why these probabilities — shown to the admin in the
  // review queue, not persisted on the published bet.
  rationale: string;
};

export type SuggestionBatch = {
  suggestions: LiveBetSuggestion[];
};

// The tool name the Messages API must call. Forced via
// tool_choice:{type:"tool",name:SUGGESTION_TOOL_NAME}.
export const SUGGESTION_TOOL_NAME = "emit_live_bet_suggestions";

// JSON Schema for the tool input. Kept in lockstep with the types above.
// `additionalProperties:false` everywhere so a hallucinated field surfaces
// as a validation error rather than silently riding along into the DB.
export const SUGGESTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "questionHe",
          "questionEn",
          "answerType",
          "gradingRuleHe",
          "gradingRuleEn",
          "grading",
          "rationale",
        ],
        properties: {
          questionHe: { type: "string", minLength: 1 },
          questionEn: { type: "string", minLength: 1 },
          answerType: { type: "string", enum: ["yes_no", "multi_choice"] },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["value", "labelHe", "labelEn", "probability"],
              properties: {
                value: { type: "string", minLength: 1 },
                labelHe: { type: "string", minLength: 1 },
                labelEn: { type: "string", minLength: 1 },
                probability: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
          yesProbability: { type: "number", minimum: 0, maximum: 1 },
          gradingRuleHe: { type: "string", minLength: 3 },
          gradingRuleEn: { type: "string", minLength: 3 },
          grading: {
            // null OR one of the supported auto sources. The Messages API
            // accepts a oneOf with a null branch for an optional object.
            oneOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["source", "field"],
                properties: {
                  source: { type: "string", enum: ["auto_football_data"] },
                  field: { type: "string", minLength: 1 },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["source", "stat", "aggregate"],
                properties: {
                  source: { type: "string", enum: ["auto_api_football"] },
                  stat: { type: "string", minLength: 1 },
                  aggregate: {
                    type: "string",
                    enum: ["sum_day", "per_match", "first_match"],
                  },
                },
              },
              {
                // Event-timeline auto-grading (red card in a half, goal in
                // a minute window). Only valid on yes_no bets. VAR is not a
                // permitted metric — the feed under-reports it.
                type: "object",
                additionalProperties: false,
                required: ["source", "events"],
                properties: {
                  source: { type: "string", enum: ["auto_api_football"] },
                  events: {
                    type: "object",
                    additionalProperties: false,
                    required: ["metric", "window", "op", "value"],
                    properties: {
                      metric: {
                        type: "string",
                        enum: ["red_card", "yellow_card", "card", "goal", "penalty", "substitution"],
                      },
                      // Player-prop filter. When set, the market resolves on
                      // events by THIS api-football player id only (the id
                      // must come from the dossier's key-player list). For a
                      // "to assist" market set byAssist:true with metric goal.
                      // A yes_no answer is required (e.g. "X to score?").
                      playerApiId: { type: "integer", minimum: 1 },
                      byAssist: { type: "boolean" },
                      window: {
                        oneOf: [
                          { type: "string", enum: ["1H", "2H", "FT"] },
                          {
                            type: "object",
                            additionalProperties: false,
                            required: ["fromMinute", "toMinute"],
                            properties: {
                              fromMinute: { type: "number", minimum: 0, maximum: 130 },
                              toMinute: { type: "number", minimum: 0, maximum: 130 },
                            },
                          },
                        ],
                      },
                      op: { type: "string", enum: [">=", ">", "=", "<=", "<"] },
                      value: { type: "number", minimum: 0 },
                      team: { type: "string", enum: ["home", "away", "any"] },
                    },
                  },
                },
              },
              {
                // "Which window did the FIRST <metric> fall in" distribution.
                // Only valid on multi_choice bets whose options are minute
                // ranges (1-15 / 16-30 / ...) plus one non-range "no event"
                // bucket. The grader buckets the first matching event's clock
                // minute. No op/value/window — the windows ARE the options.
                type: "object",
                additionalProperties: false,
                required: ["source", "firstEventWindow"],
                properties: {
                  source: { type: "string", enum: ["auto_api_football"] },
                  firstEventWindow: {
                    type: "object",
                    additionalProperties: false,
                    required: ["metric"],
                    properties: {
                      metric: {
                        type: "string",
                        enum: ["goal", "yellow_card", "red_card", "card", "penalty", "substitution"],
                      },
                      // Optional narrowing, same semantics as the events spec.
                      team: { type: "string", enum: ["home", "away", "any"] },
                      playerApiId: { type: "integer", minimum: 1 },
                      byAssist: { type: "boolean" },
                    },
                  },
                },
              },
              {
                // Comeback (lead-then-lose) market. yes_no only. The grader
                // reconstructs the running score from goals and checks if the
                // full-time winner ever trailed. `team` narrows to one side
                // completing the comeback.
                type: "object",
                additionalProperties: false,
                required: ["source", "comeback"],
                properties: {
                  source: { type: "string", enum: ["auto_api_football"] },
                  comeback: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      team: { type: "string", enum: ["home", "away", "any"] },
                    },
                  },
                },
              },
            ],
          },
          rationale: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;
