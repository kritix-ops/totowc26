import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { getDefaultDictionary } from "../../dictionaries";
import { listAllOverrides } from "@/lib/content-overrides";
import { localePath } from "@/lib/paths";
import {
  RulesEditor,
  type RulesEntry,
  type PageGuideEntry,
} from "./RulesEditor";

// Ordered manifest of the editable strings that live on the public
// rules page. Hebrew group labels match the visual sections of the
// rules page itself so an admin can scan the editor and the public page
// side by side. Order matters: the editor renders groups top-to-bottom
// in this order.
const RULES_BODY_GROUPS: Array<{
  he: string;
  en: string;
  keys: ReadonlyArray<{ key: string; labelHe: string; labelEn: string }>;
}> = [
  {
    he: "כותרת ופתיחה",
    en: "Header & intro",
    keys: [
      { key: "rules.title", labelHe: "כותרת ראשית", labelEn: "Main heading" },
      { key: "rules.subtitle", labelHe: "כותרת משנה", labelEn: "Subtitle" },
      { key: "rules.whatTitle", labelHe: "מה זה? — כותרת", labelEn: "What is this? — heading" },
      { key: "rules.whatBody", labelHe: "מה זה? — תוכן", labelEn: "What is this? — body" },
    ],
  },
  {
    he: "איך מהמרים",
    en: "How to bet",
    keys: [
      { key: "rules.howTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.howBody", labelHe: "תוכן", labelEn: "Body" },
    ],
  },
  {
    he: "מועדי סגירה",
    en: "Deadlines",
    keys: [
      { key: "rules.deadlinesTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.deadlinesBody", labelHe: "תוכן", labelEn: "Body" },
    ],
  },
  {
    he: "ניקוד משחקים",
    en: "Match scoring",
    keys: [
      { key: "rules.scoringTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.scoringPointsUnit", labelHe: "יחידת ניקוד (נק׳ / pts)", labelEn: "Points unit" },
      { key: "rules.scoringExact", labelHe: "תווית — תוצאה מדויקת", labelEn: "Label — exact score" },
      { key: "rules.scoringDirection", labelHe: "תווית — כיוון נכון", labelEn: "Label — correct direction" },
      { key: "rules.scoringWrong", labelHe: "תווית — ניחוש שגוי", labelEn: "Label — wrong pick" },
      { key: "rules.scoringRiskOffNote", labelHe: "הערה — מצב סיכון כבוי", labelEn: "Risk-off note" },
      { key: "rules.scoringRiskOnNote", labelHe: "הערה — מצב סיכון פעיל", labelEn: "Risk-on note" },
      { key: "rules.scoringExtras", labelHe: "טקסט סיום", labelEn: "Closing note" },
    ],
  },
  {
    he: "הימורי לייב",
    en: "Live bets",
    keys: [
      { key: "rules.liveTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.liveBody", labelHe: "תוכן", labelEn: "Body" },
    ],
  },
  {
    he: "תוצאות חיות",
    en: "Live scoreboard",
    keys: [
      { key: "rules.liveViewTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.liveViewBody", labelHe: "תוכן", labelEn: "Body" },
    ],
  },
  {
    he: "דו-קרב",
    en: "Duels",
    keys: [
      { key: "rules.duelsTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.duelsBody", labelHe: "תוכן", labelEn: "Body" },
    ],
  },
  {
    he: "מובילים",
    en: "Leaderboards",
    keys: [
      { key: "rules.leaderboardTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.leaderboardBody", labelHe: "תוכן", labelEn: "Body" },
    ],
  },
  {
    he: "שקיפות",
    en: "Transparency",
    keys: [
      { key: "rules.transparencyTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.transparencyBody", labelHe: "תוכן", labelEn: "Body" },
    ],
  },
  {
    he: "בנק נקודות",
    en: "Points bank",
    keys: [
      { key: "rules.bankTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.bankBody", labelHe: "תוכן (כולל {startingBank})", labelEn: "Body (uses {startingBank})" },
    ],
  },
  {
    he: "קופה ופרסים",
    en: "Pot & prizes",
    keys: [
      { key: "rules.prizesTitle", labelHe: "כותרת", labelEn: "Heading" },
      { key: "rules.prizesEntry", labelHe: "דמי השתתפות", labelEn: "Entry-fee line" },
      { key: "rules.prizesBody", labelHe: "תוכן", labelEn: "Body" },
    ],
  },
  {
    he: "הסבר על הדפים — כותרת המקטע",
    en: "Page guide — section heading",
    keys: [
      { key: "rules.pagesGuideTitle", labelHe: "כותרת המקטע", labelEn: "Section heading" },
      { key: "rules.pagesGuideIntro", labelHe: "פתיח קצר", labelEn: "Intro line" },
    ],
  },
  {
    he: "כפתורים",
    en: "Buttons",
    keys: [
      { key: "rules.ctaBack", labelHe: "כפתור חזרה", labelEn: "Back button" },
    ],
  },
];

// Same key order as the public rules page uses to render the guide.
// `meBank` carries the slash-bearing public path "me/bank" — the
// dictionary key uses camelCase because dot paths can't contain "/".
const PAGE_GUIDE_LAYOUT: ReadonlyArray<{ dictKey: string; pathLabel: string }> = [
  { dictKey: "home", pathLabel: "/" },
  { dictKey: "bets", pathLabel: "/bets" },
  { dictKey: "live", pathLabel: "/live" },
  { dictKey: "duels", pathLabel: "/duels" },
  { dictKey: "leaderboard", pathLabel: "/leaderboard" },
  { dictKey: "transparency", pathLabel: "/transparency" },
  { dictKey: "meBank", pathLabel: "/me/bank" },
  { dictKey: "tournament", pathLabel: "/tournament" },
  { dictKey: "pay", pathLabel: "/pay" },
  { dictKey: "profile", pathLabel: "/profile" },
  { dictKey: "notifications", pathLabel: "/notifications" },
  { dictKey: "rules", pathLabel: "/rules" },
];

function readLeaf(dict: unknown, dottedKey: string): string {
  const parts = dottedKey.split(".");
  let node: unknown = dict;
  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return "";
    }
  }
  return typeof node === "string" ? node : "";
}

export default async function AdminRulesPage({
  params,
}: PageProps<"/[lang]/admin/rules">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [heDefault, enDefault, overrides] = await Promise.all([
    getDefaultDictionary("he"),
    getDefaultDictionary("en"),
    listAllOverrides(),
  ]);

  const overridesByKey = new Map<
    string,
    { he: string | null; en: string | null }
  >();
  for (const o of overrides) {
    const slot = overridesByKey.get(o.key) ?? { he: null, en: null };
    if (o.locale === "he") slot.he = o.value;
    else if (o.locale === "en") slot.en = o.value;
    overridesByKey.set(o.key, slot);
  }

  // Build the flat entries that drive the body editor. Each row carries
  // the default (for slot validation + reset) and the current override
  // (so the textarea opens with what the page is actually rendering).
  const bodyGroups = RULES_BODY_GROUPS.map((g) => ({
    he: g.he,
    en: g.en,
    rows: g.keys.map<RulesEntry>((row) => {
      const ov = overridesByKey.get(row.key);
      return {
        key: row.key,
        labelHe: row.labelHe,
        labelEn: row.labelEn,
        defaultHe: readLeaf(heDefault, row.key),
        defaultEn: readLeaf(enDefault, row.key),
        overrideHe: ov?.he ?? null,
        overrideEn: ov?.en ?? null,
      };
    }),
  }));

  const pageGuideEntries: PageGuideEntry[] = PAGE_GUIDE_LAYOUT.map((entry) => {
    const nameKey = `rules.pageGuide.${entry.dictKey}.name`;
    const descKey = `rules.pageGuide.${entry.dictKey}.desc`;
    const nameOv = overridesByKey.get(nameKey);
    const descOv = overridesByKey.get(descKey);
    return {
      dictKey: entry.dictKey,
      pathLabel: entry.pathLabel,
      nameKey,
      descKey,
      defaultNameHe: readLeaf(heDefault, nameKey),
      defaultNameEn: readLeaf(enDefault, nameKey),
      defaultDescHe: readLeaf(heDefault, descKey),
      defaultDescEn: readLeaf(enDefault, descKey),
      overrideNameHe: nameOv?.he ?? null,
      overrideNameEn: nameOv?.en ?? null,
      overrideDescHe: descOv?.he ?? null,
      overrideDescEn: descOv?.en ?? null,
    };
  });

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-5xl mx-auto w-full pb-24 md:pb-10">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start min-h-[44px]"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {isHebrew ? "חוקים והסבר על הדפים" : "Rules & page guide"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "כל הטקסטים של עמוד החוקים וההסבר על כל דף באתר. כל שדה נשמר בנפרד, ב-2 שפות, וניתן לאיפוס לברירת המחדל בכל עת."
            : "Every string on the public rules page and the page-by-page guide. Each field saves independently in both languages and can reset to its default anytime."}
        </p>
        <Link
          href={localePath(locale, "rules")}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-sm font-bold text-primary hover:text-primary/80 min-h-[44px] inline-flex items-center"
        >
          {isHebrew ? "פתח את עמוד החוקים בלשונית חדשה ↗" : "Open the rules page in a new tab ↗"}
        </Link>
      </header>

      <RulesEditor
        locale={locale}
        bodyGroups={bodyGroups}
        pageGuide={pageGuideEntries}
      />
    </section>
  );
}
