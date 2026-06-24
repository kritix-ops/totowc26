// Pure template for a "who finishes first in group X" bet, so the admin
// group-bets page can deep-link into the normal create form (bets/new)
// already filled with the group's teams as choice options. Keeping it pure
// (no DB, no client) means bets/new can build the InitialBet from it and a
// unit test can assert the copy + option mapping without a database.
//
// The group winner is a free-pick (scope=group) multi_choice bet graded
// manually — the same shape the generic form produces, just pre-populated.

import type { MultiChoiceOption } from "./types";

export type GroupBetTeam = {
  code: string;
  nameHe: string;
  nameEn: string;
};

export type GroupBetTemplate = {
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  options: MultiChoiceOption[];
};

// Build the question, grading rule, and team options for one group. The
// group letter is upper-cased so "a" and "A" read identically. Teams arrive
// already ordered by the caller; an empty list yields an option-less
// template (the form still lets the admin add options by hand).
export function buildGroupBetTemplate(
  groupId: string,
  teams: ReadonlyArray<GroupBetTeam>,
): GroupBetTemplate {
  const g = groupId.toUpperCase();
  return {
    questionHe: `מי תסיים ראשונה בבית ${g}?`,
    questionEn: `Who will finish 1st in Group ${g}?`,
    gradingRuleHe: `הנבחרת שתסיים במקום הראשון בבית ${g} בתום שלב הבתים, לפי הדירוג הרשמי.`,
    gradingRuleEn: `The team that finishes 1st in Group ${g} at the end of the group stage, per the official standings.`,
    options: teams.map((t) => ({
      value: t.code,
      labelHe: t.nameHe,
      labelEn: t.nameEn,
    })),
  };
}
