"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customBets } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/admin";
import type { AnswerConfig } from "@/lib/bets/types";

// Server action for the admin "Tournament suggestions" page. Publishes
// a tournament-scope custom bet from a template the admin reviewed.
//
// Differs from publishSuggestion (live-bets/suggestions) in two ways:
//   1. scope='tournament' — no match or matchday anchor.
//   2. answer type can be anything: yes_no, number, multi_choice,
//      free_text. The template defines the shape.
//
// The action stays close to createCustomBet in shape so a future
// refactor can fold both behind a single entry point.

type Err =
  | "unauth"
  | "forbidden"
  | "invalid_input"
  | "lock_in_past"
  | "db";

export type TournamentTemplateInput = {
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: AnswerConfig;
  stake: number;
  payout: number;
  // ISO 8601. Tournament bets lock at admin discretion (usually the
  // first relevant kickoff). Validated to be in the future.
  lockAt: string;
  // Bypass the "already exists" guard when the admin has explicitly
  // confirmed they want a second copy. Default false → server refuses
  // to publish when an active tournament bet with the same question_he
  // is already in (draft, open, locked).
  force?: boolean;
};

export type PublishTournamentResult =
  | { ok: true; id: string }
  | { ok: false; error: Err }
  // Reserved for the duplicate-guard. The client surfaces a confirm
  // dialog and re-submits with force=true. The existing bet id lets
  // the UI link the admin to the live copy if they want to inspect
  // before deciding.
  | { ok: false; error: "duplicate_exists"; existingId: string };

export async function publishTournamentTemplate(
  input: TournamentTemplateInput,
): Promise<PublishTournamentResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauth" };
  if (!(await isAdmin(user.id))) {
    console.warn("[tournament publish denied]", { userId: user.id });
    return { ok: false, error: "forbidden" };
  }

  if (
    !Number.isInteger(input.stake) ||
    !Number.isInteger(input.payout) ||
    input.stake < 0 ||
    input.payout <= input.stake ||
    input.questionHe.trim().length === 0 ||
    input.questionEn.trim().length === 0 ||
    input.gradingRuleHe.trim().length < 3 ||
    input.gradingRuleEn.trim().length < 3
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const lockAt = new Date(input.lockAt);
  if (Number.isNaN(lockAt.getTime()) || lockAt.getTime() <= Date.now()) {
    return { ok: false, error: "lock_in_past" };
  }

  // Duplicate guard. Same scope='tournament' + identical question_he
  // already in an active state means the admin is re-publishing the
  // same template. We bail out and let the client re-submit with
  // force=true if they actually want two copies.
  if (!input.force) {
    const existing = await db
      .select({ id: customBets.id })
      .from(customBets)
      .where(
        and(
          eq(customBets.scope, "tournament"),
          eq(customBets.questionHe, input.questionHe.trim()),
          inArray(customBets.status, ["draft", "open", "locked"]),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      console.info("[tournament publish blocked: duplicate]", {
        adminId: user.id,
        existingId: existing[0].id,
        questionHe: input.questionHe.trim(),
      });
      return {
        ok: false,
        error: "duplicate_exists",
        existingId: existing[0].id,
      };
    }
  }

  try {
    const [row] = await db
      .insert(customBets)
      .values({
        scope: "tournament",
        questionHe: input.questionHe.trim(),
        questionEn: input.questionEn.trim(),
        gradingRuleHe: input.gradingRuleHe.trim(),
        gradingRuleEn: input.gradingRuleEn.trim(),
        answerType: input.answerType,
        answerConfig: input.answerConfig,
        stakeSnapshot: input.stake,
        payoutSnapshot: input.payout,
        gradingSource: "manual",
        gradingConfig: null,
        status: "open",
        lockAt,
        publishedAt: new Date(),
        createdBy: user.id,
      })
      .returning({ id: customBets.id });

    console.info("[tournament publish]", {
      adminId: user.id,
      customBetId: row.id,
      answerType: input.answerType,
      stake: input.stake,
      payout: input.payout,
      lockAt: lockAt.toISOString(),
    });
    revalidatePath("/[lang]/admin/tournament-suggestions", "page");
    revalidatePath("/[lang]/bets/tournament", "page");
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[tournament publish] insert failed:", err);
    return { ok: false, error: "db" };
  }
}
