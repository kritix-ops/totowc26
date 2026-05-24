export type Team = {
  code: string;
  he: string;
  en: string;
  flag: string;
};

export const TEAMS: Record<string, Team> = {
  BRA: { code: "BRA", he: "ברזיל", en: "Brazil", flag: "🇧🇷" },
  GER: { code: "GER", he: "גרמניה", en: "Germany", flag: "🇩🇪" },
  ARG: { code: "ARG", he: "ארגנטינה", en: "Argentina", flag: "🇦🇷" },
  FRA: { code: "FRA", he: "צרפת", en: "France", flag: "🇫🇷" },
  ESP: { code: "ESP", he: "ספרד", en: "Spain", flag: "🇪🇸" },
  ITA: { code: "ITA", he: "איטליה", en: "Italy", flag: "🇮🇹" },
  ENG: { code: "ENG", he: "אנגליה", en: "England", flag: "🇬🇧" },
  NED: { code: "NED", he: "הולנד", en: "Netherlands", flag: "🇳🇱" },
  POR: { code: "POR", he: "פורטוגל", en: "Portugal", flag: "🇵🇹" },
  BEL: { code: "BEL", he: "בלגיה", en: "Belgium", flag: "🇧🇪" },
  USA: { code: "USA", he: "ארה\"ב", en: "USA", flag: "🇺🇸" },
  MEX: { code: "MEX", he: "מקסיקו", en: "Mexico", flag: "🇲🇽" },
  CAN: { code: "CAN", he: "קנדה", en: "Canada", flag: "🇨🇦" },
  CRO: { code: "CRO", he: "קרואטיה", en: "Croatia", flag: "🇭🇷" },
  URU: { code: "URU", he: "אורוגוואי", en: "Uruguay", flag: "🇺🇾" },
  JPN: { code: "JPN", he: "יפן", en: "Japan", flag: "🇯🇵" },
};

export const teamName = (code: string, locale: "he" | "en") =>
  TEAMS[code]?.[locale] ?? code;

export type Match = {
  id: string;
  home: string;
  away: string;
  kickoff: string;
  group?: string;
  myBet?: { home: number; away: number };
  actual?: { home: number; away: number };
  status: "scheduled" | "live" | "final";
  countdownLabel?: { he: string; en: string };
};

export const UPCOMING_MATCHES: Match[] = [
  {
    id: "m-bra-ger",
    home: "BRA",
    away: "GER",
    kickoff: "2026-06-15T19:00:00Z",
    group: "A",
    myBet: { home: 2, away: 1 },
    status: "scheduled",
    countdownLabel: { he: "עוד שעתיים", en: "in 2 hours" },
  },
  {
    id: "m-arg-fra",
    home: "ARG",
    away: "FRA",
    kickoff: "2026-06-16T20:00:00Z",
    group: "B",
    myBet: { home: 1, away: 1 },
    status: "scheduled",
    countdownLabel: { he: "מחר, 20:00", en: "Tomorrow, 8 PM" },
  },
  {
    id: "m-esp-ita",
    home: "ESP",
    away: "ITA",
    kickoff: "2026-06-17T18:00:00Z",
    group: "C",
    status: "scheduled",
    countdownLabel: { he: "14 ביוני, 18:00", en: "Jun 14, 6 PM" },
  },
];

export const LAST_FINAL: Match = {
  id: "m-eng-ned",
  home: "ENG",
  away: "NED",
  kickoff: "2026-06-13T20:00:00Z",
  myBet: { home: 3, away: 1 },
  actual: { home: 3, away: 1 },
  status: "final",
};

export type LeaderboardRow = {
  rank: number;
  name: string;
  points: number;
  delta: number;
  streak: number;
  isYou?: boolean;
};

export const LEADERBOARD: LeaderboardRow[] = [
  { rank: 1, name: "יורם כהן", points: 187, delta: 0, streak: 5 },
  { rank: 2, name: "דנה לוי", points: 184, delta: 1, streak: 3 },
  { rank: 3, name: "אבי מזרחי", points: 178, delta: -1, streak: 2 },
  { rank: 4, name: "טל בן דוד", points: 175, delta: 0, streak: 1 },
  { rank: 5, name: "נועה שרון", points: 173, delta: 2, streak: 4 },
  { rank: 6, name: "רוני חיים", points: 175, delta: -2, streak: 0 },
  { rank: 7, name: "אתה", points: 173, delta: 1, streak: 2, isYou: true },
  { rank: 8, name: "מאיה פרץ", points: 168, delta: 0, streak: 0 },
  { rank: 9, name: "אסף הרץ", points: 165, delta: -3, streak: 0 },
  { rank: 10, name: "ליאור גרין", points: 162, delta: 0, streak: 1 },
];

export type Group = {
  id: string;
  teams: string[];
};

export const GROUPS: Group[] = [
  { id: "A", teams: ["BRA", "MEX", "CRO", "JPN"] },
  { id: "B", teams: ["ARG", "FRA", "URU", "CAN"] },
  { id: "C", teams: ["ESP", "ITA", "POR", "USA"] },
  { id: "D", teams: ["GER", "ENG", "NED", "BEL"] },
];

export type FriendBet = {
  name: string;
  bet: { home: number; away: number };
  correct: boolean;
  earned: number;
};

export const FRIEND_BETS_FOR_LAST: FriendBet[] = [
  { name: "יורם כהן", bet: { home: 3, away: 1 }, correct: true, earned: 15 },
  { name: "אתה", bet: { home: 3, away: 1 }, correct: true, earned: 15 },
  { name: "דנה לוי", bet: { home: 2, away: 1 }, correct: false, earned: 5 },
  { name: "אבי מזרחי", bet: { home: 2, away: 0 }, correct: false, earned: 1 },
  { name: "טל בן דוד", bet: { home: 1, away: 1 }, correct: false, earned: 0 },
  { name: "נועה שרון", bet: { home: 3, away: 2 }, correct: false, earned: 1 },
];

export type Payment = {
  id: string;
  user: string;
  method: "bit" | "paybox";
  amount: number;
  at: string;
};

export const PENDING_PAYMENTS: Payment[] = [
  { id: "p1", user: "אסף הרץ", method: "bit", amount: 100, at: "12:43" },
  { id: "p2", user: "ליאור גרין", method: "paybox", amount: 100, at: "12:11" },
  { id: "p3", user: "תמר אבן", method: "bit", amount: 100, at: "10:58" },
];

export const POINTS_TREND = [80, 60, 90, 70, 30, 10];

export const PROFILE_STATS = {
  exactScoreAccuracy: 24,
  outcomeAccuracy: 68,
  streak: 3,
  totalPoints: 173,
  memberSince: { he: "מאי 2026", en: "May 2026" },
};
