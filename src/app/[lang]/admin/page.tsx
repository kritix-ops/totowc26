import { notFound } from "next/navigation";
import {
  CircleDollarSign,
  Users,
  Coins,
  Sparkles,
  Trophy,
  ScrollText,
  Languages,
  Smartphone,
  Clock,
  Grid3x3,
  CalendarX2,
  Copy,
  EyeOff,
  Megaphone,
  Type,
  BookOpenText,
  Wrench,
  FlaskConical,
  ListChecks,
  Flag,
} from "lucide-react";
import { hasLocale, type Locale } from "../dictionaries";
import { Card, LabelCaps } from "@/components/ui";
import {
  countDuplicateCustomBets,
  getPaymentTotals,
} from "@/db/admin-queries";
import { isSandbox } from "@/lib/env";
import { requireAdminAccess } from "@/lib/admin";
import { countPendingSignups } from "./signup-requests/queries";
import { AdminSection, AdminTile } from "./AdminSections";

// Admin landing page. Replaces the old flat 15-tile grid + 6 inline
// panels with five purpose-built sections. The heavy ops panels
// (Sync/Backup/etc) and one-time-config panels moved to /admin/system;
// payment approval moved into /admin/users as a third tab; the two
// player-page shortcuts (matches, standings) dropped — the bottom-nav
// already covers them.
export default async function AdminPage({
  params,
}: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";

  // Resolve the viewer's role and permission set. The layout already
  // enforced access (path-level too) — this is a render-time branch so
  // we can hide tiles a scoped operator cannot reach.
  const { access } = await requireAdminAccess(locale);
  const isFullAdmin = access.role === "admin";
  const can = (k: "liveBets" | "tournamentBets" | "tournamentOdds") =>
    isFullAdmin || access.permissions[k] === true;

  const [totals, duplicateBetCount, pendingSignupCount] = await Promise.all([
    isFullAdmin ? getPaymentTotals() : Promise.resolve({ approvedSumIls: 0, pendingCount: 0 }),
    countDuplicateCustomBets(),
    isFullAdmin ? countPendingSignups() : Promise.resolve(0),
  ]);

  // Combined attention count for the משתתפים tile — pending signup
  // requests + pending payments. Both live inside /admin/users now, so
  // a single badge reflects the total work waiting there.
  const peopleAttention = pendingSignupCount + totals.pendingCount;

  if (!isFullAdmin) {
    return (
      <section className="px-4 md:px-10 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24 md:pb-12">
        <header className="flex flex-col gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
            {isHebrew ? "ניהול" : "Admin"}
          </h1>
          <p className="text-sm md:text-base text-on-surface-variant">
            {isHebrew
              ? "אלה הכלים שיש לך הרשאה אליהם. אם חסר משהו, בקש מהאדמין הראשי להוסיף את ההרשאה."
              : "These are the tools you have permission to use. If something is missing, ask the main admin to grant the permission."}
          </p>
        </header>

        {can("liveBets") && (
          <AdminSection title={isHebrew ? "הימורי לייב" : "Live bets"}>
            <AdminTile
              locale={locale}
              path="admin/bets"
              icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />}
              label={isHebrew ? "הימורי לייב" : "Live bets"}
            />
            <AdminTile
              locale={locale}
              path="admin/live-bets/suggestions"
              icon={<Grid3x3 className="h-5 w-5" strokeWidth={1.75} />}
              label={isHebrew ? "הצעות יום משחקים" : "Matchday suggestions"}
            />
            <AdminTile
              locale={locale}
              path="admin/bets-overview"
              icon={<Grid3x3 className="h-5 w-5" strokeWidth={1.75} />}
              label={isHebrew ? "מצב הימורי כולם" : "Everyone's bets"}
            />
            <AdminTile
              locale={locale}
              path="admin/group-bets"
              icon={<Flag className="h-5 w-5" strokeWidth={1.75} />}
              label={isHebrew ? "הימורי בתים" : "Group bets"}
            />
            <AdminTile
              locale={locale}
              path="admin/deadlines"
              icon={<Clock className="h-5 w-5" strokeWidth={1.75} />}
              label={isHebrew ? "מועדי סגירה" : "Deadlines"}
            />
            {duplicateBetCount > 0 && (
              <AdminTile
                locale={locale}
                path="admin/bets/duplicates"
                icon={<Copy className="h-5 w-5" strokeWidth={1.75} />}
                label={isHebrew ? "כפילויות הימורים" : "Duplicate bets"}
                badge={duplicateBetCount}
                tone="warning"
              />
            )}
          </AdminSection>
        )}

        {can("tournamentBets") && (
          <AdminSection title={isHebrew ? "הימורי טורניר" : "Tournament bets"}>
            <AdminTile
              locale={locale}
              path="admin/tournament-suggestions"
              icon={<Trophy className="h-5 w-5" strokeWidth={1.75} />}
              label={isHebrew ? "הימורי טורניר" : "Tournament bets"}
            />
          </AdminSection>
        )}

        {can("tournamentOdds") && (
          <AdminSection title={isHebrew ? "יחסים" : "Odds"}>
            <AdminTile
              locale={locale}
              path="admin/tournament-odds"
              icon={<ScrollText className="h-5 w-5" strokeWidth={1.75} />}
              label={isHebrew ? "יחסי טורניר" : "Tournament odds"}
            />
          </AdminSection>
        )}
      </section>
    );
  }

  return (
    <section className="px-4 md:px-10 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24 md:pb-12">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {isHebrew ? "ניהול" : "Admin"}
        </h1>
        <Card className="px-5 py-3 flex items-center gap-3 self-start md:self-auto">
          <CircleDollarSign
            className="h-5 w-5 text-tertiary shrink-0"
            strokeWidth={1.5}
          />
          <div className="flex flex-col min-w-0">
            <LabelCaps>{isHebrew ? "סה״כ בקופה" : "Pot total"}</LabelCaps>
            <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-surface-tint">
              <bdi>{totals.approvedSumIls.toLocaleString()}</bdi>{" "}
              {isHebrew ? "ש״ח" : "ILS"}
            </span>
          </div>
        </Card>
      </header>

      <AdminSection title={isHebrew ? "אנשים וכסף" : "People & money"}>
        <AdminTile
          locale={locale}
          path="admin/users"
          icon={<Users className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "משתתפים, תשלומים ובקשות" : "Players, payments & requests"}
          badge={peopleAttention > 0 ? peopleAttention : undefined}
          tone={peopleAttention > 0 ? "warning" : "default"}
        />
        <AdminTile
          locale={locale}
          path="admin/settings/scoring"
          icon={<Coins className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "ניקוד ובנק" : "Scoring & bank"}
        />
        <AdminTile
          locale={locale}
          path="admin/deadlines"
          icon={<Clock className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "מועדי סגירה" : "Deadlines"}
        />
        <AdminTile
          locale={locale}
          path="admin/matches"
          icon={<CalendarX2 className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "ניהול משחקים (דחייה/ביטול)" : "Match management"}
        />
      </AdminSection>

      <AdminSection title={isHebrew ? "הימורים" : "Bets"}>
        <AdminTile
          locale={locale}
          path="admin/bets-overview"
          icon={<Grid3x3 className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "מצב הימורי כולם" : "Everyone's bets"}
        />
        <AdminTile
          locale={locale}
          path="admin/my-bets"
          icon={<ListChecks className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "ההימורים שלי (תיקון בדיעבד)" : "My bets (backdate)"}
        />
        <AdminTile
          locale={locale}
          path="admin/bets"
          icon={<Sparkles className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "הימורי לייב" : "Live bets"}
        />
        <AdminTile
          locale={locale}
          path="admin/group-bets"
          icon={<Flag className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "הימורי בתים" : "Group bets"}
        />
        <AdminTile
          locale={locale}
          path="admin/tournament-suggestions"
          icon={<Trophy className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "הימורי טורניר" : "Tournament bets"}
        />
        <AdminTile
          locale={locale}
          path="admin/tournament-odds"
          icon={<ScrollText className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "יחסי טורניר" : "Tournament odds"}
        />
        {duplicateBetCount > 0 && (
          <AdminTile
            locale={locale}
            path="admin/bets/duplicates"
            icon={<Copy className="h-5 w-5" strokeWidth={1.75} />}
            label={isHebrew ? "כפילויות הימורים" : "Duplicate bets"}
            badge={duplicateBetCount}
            tone="warning"
          />
        )}
        <AdminTile
          locale={locale}
          path="admin/players"
          icon={<Languages className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "תרגום שחקנים" : "Player translations"}
        />
      </AdminSection>

      <AdminSection title={isHebrew ? "תוכן ונראות" : "Content & visibility"}>
        <AdminTile
          locale={locale}
          path="admin/content"
          icon={<Type className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "עריכת תוכן" : "Content editor"}
        />
        <AdminTile
          locale={locale}
          path="admin/rules"
          icon={<BookOpenText className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "חוקים והסבר על הדפים" : "Rules & page guide"}
        />
        <AdminTile
          locale={locale}
          path="admin/pages"
          icon={<EyeOff className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "זמינות עמודים" : "Page visibility"}
        />
        <AdminTile
          locale={locale}
          path="admin/settings/mobile-nav"
          icon={<Smartphone className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "תפריט מובייל" : "Mobile nav"}
        />
      </AdminSection>

      <AdminSection title={isHebrew ? "תקשורת" : "Communications"}>
        <AdminTile
          locale={locale}
          path="admin/broadcast"
          icon={<Megaphone className="h-5 w-5" strokeWidth={1.75} />}
          label={isHebrew ? "שליחת הודעה" : "Broadcast"}
        />
      </AdminSection>

      <AdminSection title={isHebrew ? "מערכת ותפעול" : "System & ops"}>
        <AdminTile
          locale={locale}
          path="admin/system"
          icon={<Wrench className="h-5 w-5" strokeWidth={1.75} />}
          label={
            isHebrew
              ? "סנכרון, גיבוי, גישות ובדיקות"
              : "Sync, backup, access & diagnostics"
          }
        />
        {isSandbox() && (
          <AdminTile
            locale={locale}
            path="admin/sandbox"
            icon={<FlaskConical className="h-5 w-5" strokeWidth={1.75} />}
            label={isHebrew ? "סאנדבוקס ↔ פרודקשן" : "Sandbox ↔ production"}
            tone="warning"
          />
        )}
      </AdminSection>
    </section>
  );
}
