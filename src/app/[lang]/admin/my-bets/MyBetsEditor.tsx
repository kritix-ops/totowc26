"use client";

import type { ComponentProps } from "react";
import {
  AdminPickEditor,
  type AdminPickActions,
} from "../users/[id]/bets/AdminPickEditor";
import {
  backdateAdvancePickForUser,
  backdateCustomBetPickForUser,
  backdateMatchPickForUser,
  clearAdvancePickForUser,
  clearCustomBetPickForUser,
  clearMatchPickForUser,
} from "./actions";

// Backdate wrapper around the shared AdminPickEditor. Injects the full-admin,
// audited backdate actions so the exact same dialog UI serves an admin fixing
// ANY user's bets (their own or another's) after kickoff — including the
// "who advances?" surface. Importing the server actions here (client module)
// and building the object client-side keeps the action references out of the
// server→client prop boundary.
const BACKDATE_ACTIONS: AdminPickActions = {
  setCustom: backdateCustomBetPickForUser,
  clearCustom: clearCustomBetPickForUser,
  setMatch: backdateMatchPickForUser,
  clearMatch: clearMatchPickForUser,
  setAdvance: backdateAdvancePickForUser,
  clearAdvance: clearAdvancePickForUser,
};

// Distributive Omit so the (CustomKind | MatchKind | AdvanceKind) discriminated
// union is preserved — a plain Omit over a union collapses it to the shared
// keys and drops surface-specific props like customBetId / matchId / homeCode.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type Props = DistributiveOmit<ComponentProps<typeof AdminPickEditor>, "actions">;

export function MyBetsEditor(props: Props) {
  return <AdminPickEditor {...props} actions={BACKDATE_ACTIONS} />;
}
