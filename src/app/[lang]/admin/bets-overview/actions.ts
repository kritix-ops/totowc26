"use server";

import { hasPermission } from "@/lib/admin";
import { getUser } from "@/lib/supabase/auth";
import {
  fetchPlayerNamesById,
  fetchUserBetsForAdmin,
  fetchUserMatchPicksForAdmin,
  type AdminUserBetRow,
  type AdminUserMatchPickRow,
} from "../users/queries";
import { renderPickAnswer } from "@/lib/bets/format";
import type { Locale } from "../../dictionaries";

// Read action behind the bets-overview drawer. The overview page only ships
// the at-a-glance custom-bet matrix; when an admin opens a user the drawer
// pulls that user's FULL detail on demand — every custom bet (with a resolved
// pick label) plus every match scoreline. Lazy so the initial page stays
// light, and the client caches the result per user so re-opens are instant.
//
// Admin-gated here too (defense in depth): Server Functions are reachable by
// direct POST, not just through the UI, so the page gate is not enough.

export type DrawerCustomBet = AdminUserBetRow & {
  // Server-resolved, localized pick label (player markets included), or null
  // when the user hasn't filled this bet. Saves shipping the ~1,357-row player
  // map to the browser just to render a couple of names.
  pickLabel: string | null;
};

export type UserBetDetail = {
  customBets: DrawerCustomBet[];
  matchPicks: AdminUserMatchPickRow[];
};

export type LoadUserBetDetailResult =
  | { ok: true; detail: UserBetDetail }
  | { ok: false; error: "unauthorized" | "forbidden" };

export async function loadUserBetDetail(
  userId: string,
  locale: Locale,
): Promise<LoadUserBetDetailResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await hasPermission(user.id, "liveBets"))) return { ok: false, error: "forbidden" };

  const isHebrew = locale === "he";
  const [customRows, matchRows, playerNames] = await Promise.all([
    fetchUserBetsForAdmin(userId),
    fetchUserMatchPicksForAdmin(userId),
    fetchPlayerNamesById(),
  ]);

  const customBets: DrawerCustomBet[] = customRows.map((r) => ({
    ...r,
    pickLabel:
      r.pickId == null
        ? null
        : renderPickAnswer(
            r.answerType,
            r.answerConfig,
            r.pickAnswer,
            isHebrew,
            playerNames,
          ),
  }));

  return { ok: true, detail: { customBets, matchPicks: matchRows } };
}
