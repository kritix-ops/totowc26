import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Grid3x3 } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { requireLiveBetsAdmin } from "@/lib/admin";
import {
  fetchAllUsersBetMatrix,
  fetchPlayerNamesById,
} from "../users/queries";
import { localePath } from "@/lib/paths";
import { renderPickAnswer } from "@/lib/bets/format";
import {
  BetsOverviewExplorer,
  type OverviewBet,
  type OverviewUser,
} from "./BetsOverviewExplorer";

// All-users × all-open-bets overview. The point: in ONE screen, scan who has
// and hasn't filled each tournament-wide / group / stage bet before the
// deadline — and drill into any user to see (and edit) every pick, including
// the per-match scorelines. Search + a completion filter make a player easy to
// find on a phone. The per-user detail is loaded lazily by the drawer; here we
// only ship the at-a-glance matrix.
//
// This server component owns the admin gate + data fetch (mirroring
// /admin/users → UsersExplorer); BetsOverviewExplorer renders + filters.
export default async function AdminBetsOverviewPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  await requireLiveBetsAdmin(locale);
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [cells, playerNames] = await Promise.all([
    fetchAllUsersBetMatrix(),
    fetchPlayerNamesById(),
  ]);

  console.info("[admin bet read]", {
    page: "overview_matrix",
    cellCount: cells.length,
  });

  // Reshape: unique users (preserving the SQL display-name sort), unique bets
  // (preserving the scope/lock sort), and a sparse `${userId}|${betId}` ->
  // resolved-label map of filled picks. Player markets are resolved here so the
  // browser never receives the raw api_football_id (or the 1,357-row roster).
  const users: OverviewUser[] = [];
  const seenUsers = new Set<string>();
  const bets: OverviewBet[] = [];
  const seenBets = new Set<string>();
  const picks: Record<string, string> = {};
  for (const c of cells) {
    if (!seenUsers.has(c.userId)) {
      seenUsers.add(c.userId);
      users.push({ id: c.userId, name: c.userDisplayName });
    }
    if (!seenBets.has(c.betId)) {
      seenBets.add(c.betId);
      bets.push({
        betId: c.betId,
        scope: c.scope,
        questionHe: c.questionHe,
        questionEn: c.questionEn,
      });
    }
    if (c.pickAnswer != null) {
      picks[`${c.userId}|${c.betId}`] = renderPickAnswer(
        c.answerType,
        c.answerConfig,
        c.pickAnswer,
        isHebrew,
        playerNames,
      );
    }
  }

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 md:gap-8 max-w-[1400px] mx-auto w-full pb-24 md:pb-10">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לאדמין" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <Grid3x3 className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "מצב הימורי כולם" : "Everyone's bets"}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? `${users.length} משתתפים · ${bets.length} הימורים פתוחים. לחץ על שם משתמש לראות ולערוך את כל ההימורים שלו.`
            : `${users.length} players · ${bets.length} open bets. Tap a name to see and edit all of their bets.`}
        </p>
      </header>

      {users.length === 0 ? (
        <p className="rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-10 text-center text-on-surface-variant">
          {isHebrew ? "אין משתתפים." : "No players yet."}
        </p>
      ) : (
        <BetsOverviewExplorer
          users={users}
          bets={bets}
          picks={picks}
          locale={locale}
        />
      )}
    </section>
  );
}
