// Pure catalog + validation for the page-visibility feature. Split out
// of page-visibility.ts so client components (the admin toggle form,
// the home toast) can import labels and validators without dragging
// the server-only db/redirect code into the browser bundle. See
// _plans/2026-05-27-page-visibility.md.

export const HIDEABLE_PAGE_KEYS = [
  "bets",
  "duels",
  "leaderboard",
  "tournament",
  "live",
  "transparency",
  "pay",
  "rules",
] as const;
export type HideablePageKey = (typeof HIDEABLE_PAGE_KEYS)[number];

const HIDEABLE_SET: ReadonlySet<string> = new Set(HIDEABLE_PAGE_KEYS);

// Player-facing labels for the admin UI. Type-checked against the
// catalog so a new key forces a compile-time entry here.
export const HIDEABLE_PAGE_LABELS: Record<
  HideablePageKey,
  { he: string; en: string; pathSegment: string; hintHe: string; hintEn: string }
> = {
  bets: {
    he: "משחקים",
    en: "Matches",
    pathSegment: "/bets",
    hintHe: "כל מסך הימורי התוצאה ומסכי המשחק הבודד.",
    hintEn: "The score-prediction surface and per-match pages.",
  },
  duels: {
    he: "דו-קרבים",
    en: "Duels",
    pathSegment: "/duels",
    hintHe: "מסך 1 על 1 ליצירת דו-קרב והצטרפות.",
    hintEn: "1v1 duel creation and join screen.",
  },
  leaderboard: {
    he: "טבלת מצב",
    en: "Leaderboard",
    pathSegment: "/leaderboard",
    hintHe: "טבלת הניקוד הכללית של המשתתפים.",
    hintEn: "Overall standings of all players.",
  },
  tournament: {
    he: "טורניר",
    en: "Tournament",
    pathSegment: "/tournament",
    hintHe: "אזור הטורניר: שלבים, ברקטים, הימורי טורניר.",
    hintEn: "Tournament zone: stages, brackets, tournament-wide bets.",
  },
  live: {
    he: "שידור חי",
    en: "Live",
    pathSegment: "/live",
    hintHe: "מסך הימורי לייב בזמן אמת.",
    hintEn: "Real-time live bets surface.",
  },
  transparency: {
    he: "שקיפות",
    en: "Transparency",
    pathSegment: "/transparency",
    hintHe: "פיד גלוי של הימורים נעולים של כל המשתתפים.",
    hintEn: "Public feed of every locked bet across the pool.",
  },
  pay: {
    he: "תשלום",
    en: "Pay",
    pathSegment: "/pay",
    hintHe: "מסך תשלום דמי השתתפות.",
    hintEn: "Entry-fee payment screen.",
  },
  rules: {
    he: "חוקים",
    en: "Rules",
    pathSegment: "/rules",
    hintHe: "מסך חוקי המשחק והניקוד.",
    hintEn: "Rules and scoring explanation.",
  },
};

export const NEVER_HIDEABLE: Array<{
  key: string;
  he: string;
  en: string;
  whyHe: string;
  whyEn: string;
}> = [
  {
    key: "home",
    he: "בית",
    en: "Home",
    whyHe: "יעד ההפניה לעמודים מוסתרים - חייב להישאר זמין.",
    whyEn: "The redirect target for hidden pages — must stay reachable.",
  },
  {
    key: "admin",
    he: "ניהול",
    en: "Admin",
    whyHe: "אחרת אינך יכול לפתוח חזרה את העמודים שהסתרת.",
    whyEn: "Otherwise you can't reopen any page you hide.",
  },
  {
    key: "profile",
    he: "פרופיל",
    en: "Profile",
    whyHe: "נדרש לעריכת חשבון ושינוי סיסמה.",
    whyEn: "Needed for account edit and password reset.",
  },
  {
    key: "login",
    he: "התחברות",
    en: "Login",
    whyHe: "ללא התחברות אף שחקן לא יכול לחזור פנימה.",
    whyEn: "Without login, no player can get back in.",
  },
  {
    key: "signup",
    he: "הרשמה",
    en: "Signup",
    whyHe: "מסלול הצטרפות לחדשים - לעולם לא מוסתר.",
    whyEn: "New-player intake — never hidden.",
  },
];

// Validate keys at the server-action boundary. Returns null on any
// shape problem so the caller can return a clean "invalid" error.
export function validateHiddenKeys(keys: unknown): string[] | null {
  if (!Array.isArray(keys)) return null;
  const cleaned: string[] = [];
  for (const k of keys) {
    if (typeof k !== "string") return null;
    if (!HIDEABLE_SET.has(k)) return null;
    cleaned.push(k);
  }
  return Array.from(new Set(cleaned));
}

export function isHideablePageKey(key: unknown): key is HideablePageKey {
  return typeof key === "string" && HIDEABLE_SET.has(key);
}
