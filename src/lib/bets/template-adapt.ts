// Pure helpers for adapting a saved bet template onto a new match.
// Two layers, applied in order:
//   1. Placeholder substitution: {HOME} / {AWAY} (and bilingual aliases)
//      are replaced with the target match's team names. Templates that
//      use these tokens stay reusable across the whole tournament.
//   2. Literal swap fallback: when the template was anchored on a
//      specific source match AND that match's team names appear inside
//      the text, those literals get swapped to the target match's
//      names. Catches the common case where the original author baked
//      the team names in instead of using placeholders.
//
// Both passes are conservative — they only run when the relevant inputs
// are present (target team names always, source names only for the
// literal swap). Admin reviews + edits the result before publishing on
// /admin/bets/new, so the worst case is a misfire the admin notices
// before save.

// Placeholder tokens recognised in template text. Each token has the
// same semantic — "the home / away team's name in the rendered locale"
// — so an author can pick whichever notation fits the language of the
// surrounding text.
const HOME_TOKENS = ["{HOME}", "{home}", "{בית}"] as const;
const AWAY_TOKENS = ["{AWAY}", "{away}", "{חוץ}"] as const;

export type AdaptInput = {
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  sourceHomeNameHe?: string | null;
  sourceHomeNameEn?: string | null;
  sourceAwayNameHe?: string | null;
  sourceAwayNameEn?: string | null;
};

export type AdaptTarget = {
  homeNameHe: string;
  homeNameEn: string;
  awayNameHe: string;
  awayNameEn: string;
};

export type AdaptOutput = {
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
};

export function adaptTemplateText(
  template: AdaptInput,
  target: AdaptTarget,
): AdaptOutput {
  const adaptHe = (text: string) =>
    swapLiteral(
      replacePlaceholders(text, target.homeNameHe, target.awayNameHe),
      template.sourceHomeNameHe,
      target.homeNameHe,
      template.sourceAwayNameHe,
      target.awayNameHe,
    );
  const adaptEn = (text: string) =>
    swapLiteral(
      replacePlaceholders(text, target.homeNameEn, target.awayNameEn),
      template.sourceHomeNameEn,
      target.homeNameEn,
      template.sourceAwayNameEn,
      target.awayNameEn,
    );
  return {
    questionHe:    adaptHe(template.questionHe),
    questionEn:    adaptEn(template.questionEn),
    gradingRuleHe: adaptHe(template.gradingRuleHe),
    gradingRuleEn: adaptEn(template.gradingRuleEn),
  };
}

// Pass 1: replace every recognised placeholder token with the locale-
// matching team name. The two token sets are disjoint, so ordering
// inside this function doesn't matter.
function replacePlaceholders(
  text: string,
  homeName: string,
  awayName: string,
): string {
  let out = text;
  for (const token of HOME_TOKENS) out = out.split(token).join(homeName);
  for (const token of AWAY_TOKENS) out = out.split(token).join(awayName);
  return out;
}

// Pass 2: find-and-replace the source match's team names with the
// target's. Only runs when source names are known + different from the
// target. We sort by length desc so a longer name (Saudi Arabia)
// doesn't get half-overwritten by an earlier pass on a shorter
// substring (Saudi → Argentina would leave "Argentina Arabia"). Plain
// split/join keeps the substitution unicode-safe without escape work.
function swapLiteral(
  text: string,
  fromHome: string | null | undefined,
  toHome: string,
  fromAway: string | null | undefined,
  toAway: string,
): string {
  let out = text;
  const pairs: Array<[string, string]> = [];
  if (fromHome && fromHome !== toHome) pairs.push([fromHome, toHome]);
  if (fromAway && fromAway !== toAway) pairs.push([fromAway, toAway]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of pairs) {
    out = out.split(from).join(to);
  }
  return out;
}
