"use client";

import type { ComponentProps } from "react";
import {
  AdminPickEditor,
  type AdminPickActions,
} from "../users/[id]/bets/AdminPickEditor";
import {
  selfBackdateCustomBetPick,
  selfBackdateMatchPick,
  selfClearCustomBetPick,
  selfClearMatchPick,
} from "./actions";

// Self-backdate wrapper around the shared AdminPickEditor. Injects the
// self-only, audited write actions so the exact same dialog UI serves the
// admin editing their OWN bets after kickoff. Importing the server actions
// here (client module) and building the object client-side keeps the action
// references out of the server→client prop boundary.
const SELF_ACTIONS: AdminPickActions = {
  setCustom: selfBackdateCustomBetPick,
  clearCustom: selfClearCustomBetPick,
  setMatch: selfBackdateMatchPick,
  clearMatch: selfClearMatchPick,
};

// Distributive Omit so the (CustomKind | MatchKind) discriminated union is
// preserved — a plain Omit over a union collapses it to the shared keys and
// drops surface-specific props like customBetId / matchId.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type Props = DistributiveOmit<ComponentProps<typeof AdminPickEditor>, "actions">;

export function MyBetsEditor(props: Props) {
  return <AdminPickEditor {...props} actions={SELF_ACTIONS} />;
}
