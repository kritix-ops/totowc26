import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Plus, Swords, ChevronLeft, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { Card, Chip, LabelCaps, PillButton } from "@/components/ui";
import { PayGateBanner } from "@/components/PayGateBanner";
import { getRequestUser } from "@/lib/request-user";
import { getUserAccess } from "@/lib/access";
import { execRows } from "@/db/helpers";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";

type Tab = "open" | "mine";

type SearchSP = { tab?: string | string[] };

type PageParams = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<SearchSP>;
};

type DuelRow = {
  id: string;
  status: "open" | "matched" | "settled" | "cancelled";
  scope: "match" | "day" | "tournament";
  stake: number;
  openerAnswer: boolean;
  openerName: string;
  joinerName: string | null;
  questionHe: string;
  questionEn: string;
  joinDeadlineAt: string;
  resolveAt: string;
  resolvedValue: boolean | null;
  matchLabel: string | null;
  iAmOpener: boolean;
  iAmJoiner: boolean;
};

export default async function DuelsIndexPage({
  params,
  searchParams,
}: PageParams) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));
  const access = await getUserAccess(user.id);

  const sp = await searchParams;
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = rawTab === "mine" ? "mine" : "open";

  const duels = await loadDuels(tab, user.id);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
              <Swords className="h-6 w-6 md:h-7 md:w-7" strokeWidth={1.75} />
              {dict.duels.title}
            </h1>
            <p className="text-sm text-on-surface-variant">
              {dict.duels.subtitle}
            </p>
          </div>
          {access.canEdit && (
            <Link
              href={localePath(locale, "duels/new")}
              className="self-start sm:self-auto"
            >
              <PillButton type="button" className="min-h-[48px]">
                <Plus className="h-5 w-5" strokeWidth={2.5} />
                {dict.duels.newCta}
              </PillButton>
            </Link>
          )}
        </div>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      <nav
        aria-label={dict.duels.title}
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory"
      >
        <TabPill
          locale={locale}
          tabKey="open"
          active={tab === "open"}
          label={dict.duels.tabOpen}
        />
        <TabPill
          locale={locale}
          tabKey="mine"
          active={tab === "mine"}
          label={dict.duels.tabMine}
        />
      </nav>

      {duels.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {tab === "open" ? dict.duels.emptyOpen : dict.duels.emptyMine}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {duels.map((d) => (
            <li key={d.id}>
              <Link
                href={localePath(locale, `duels/${d.id}`)}
                className="press-down block"
              >
                <Card className="p-4 md:p-5 flex flex-col gap-3 hover:bg-surface-container transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <span className="font-[family-name:var(--font-display)] text-base md:text-lg font-bold text-on-surface">
                        {isHebrew ? d.questionHe : d.questionEn}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Chip>{scopeLabel(d.scope, dict)}</Chip>
                        {d.matchLabel && (
                          <Chip className="bidi-ltr">{d.matchLabel}</Chip>
                        )}
                        <Chip tone={statusTone(d.status)}>
                          {statusLabel(d.status, dict)}
                        </Chip>
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <LabelCaps as="div" className="mb-0.5">
                        {dict.duels.stakeLabel}
                      </LabelCaps>
                      <span className="font-[family-name:var(--font-score)] text-2xl font-bold tabular-nums">
                        {d.stake}
                      </span>
                    </div>
                    <Chev className="h-5 w-5 text-outline shrink-0 mt-1" />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-xs text-on-surface-variant">
                    <span>
                      <span className="font-bold">{dict.duels.openerLabel}:</span>{" "}
                      {d.openerName}{" "}
                      <span className="opacity-70">
                        ({d.openerAnswer ? dict.duels.yes : dict.duels.no})
                      </span>
                    </span>
                    {d.joinerName && (
                      <span>
                        <span className="font-bold">
                          {dict.duels.joinerLabel}:
                        </span>{" "}
                        {d.joinerName}
                      </span>
                    )}
                    <span className="sm:ms-auto">
                      {d.status === "open"
                        ? `${dict.duels.deadlineLabel}: ${formatDateTime(d.joinDeadlineAt, locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                        : `${dict.duels.resolveAtLabel}: ${formatDateTime(d.resolveAt, locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TabPill({
  locale,
  tabKey,
  active,
  label,
}: {
  locale: Locale;
  tabKey: Tab;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={`${localePath(locale, "duels")}?tab=${tabKey}`}
      className={clsx(
        "snap-start press-down inline-flex items-center justify-center h-10 px-4 rounded-full border text-sm font-bold",
        active
          ? "bg-primary text-on-primary border-primary"
          : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container",
      )}
    >
      {label}
    </Link>
  );
}

function scopeLabel(
  scope: DuelRow["scope"],
  dict: Awaited<ReturnType<typeof getDictionary>>,
): string {
  switch (scope) {
    case "match":
      return dict.duels.scopeMatch;
    case "day":
      return dict.duels.scopeDay;
    case "tournament":
      return dict.duels.scopeTournament;
  }
}

function statusLabel(
  status: DuelRow["status"],
  dict: Awaited<ReturnType<typeof getDictionary>>,
): string {
  switch (status) {
    case "open":
      return dict.duels.statusOpen;
    case "matched":
      return dict.duels.statusMatched;
    case "settled":
      return dict.duels.statusSettled;
    case "cancelled":
      return dict.duels.statusCancelled;
  }
}

function statusTone(
  status: DuelRow["status"],
): "primary" | "default" | "secondary" | "warning" {
  switch (status) {
    case "open":
      return "primary";
    case "matched":
      return "default";
    case "settled":
      return "secondary";
    case "cancelled":
      return "warning";
  }
}

// SQL that pulls every duel matching the selected tab + viewer.
// Joins each duel to opener / joiner display names and to the match
// label for `scope='match'`. Returns up to 100 rows.
async function loadDuels(tab: Tab, userId: string): Promise<DuelRow[]> {
  const filter =
    tab === "open"
      ? sql`d.status = 'open' and d.join_deadline_at > now()`
      : sql`(d.opener_id = ${userId} or d.joiner_id = ${userId})`;
  return execRows<DuelRow>(sql`
    select
      d.id::text                                              as "id",
      d.status::text                                          as "status",
      d.scope::text                                           as "scope",
      d.stake                                                 as "stake",
      d.opener_answer                                         as "openerAnswer",
      po.display_name                                         as "openerName",
      pj.display_name                                         as "joinerName",
      d.question_he                                           as "questionHe",
      d.question_en                                           as "questionEn",
      d.join_deadline_at::text                                as "joinDeadlineAt",
      d.resolve_at::text                                      as "resolveAt",
      d.resolved_value                                        as "resolvedValue",
      case when m.id is not null
           then m.home_team || ' vs ' || m.away_team
           else null end                                      as "matchLabel",
      (d.opener_id = ${userId})                               as "iAmOpener",
      (d.joiner_id = ${userId})                               as "iAmJoiner"
    from public.duels d
    join public.profiles po on po.id = d.opener_id
    left join public.profiles pj on pj.id = d.joiner_id
    left join public.matches m on m.id = d.match_id
    where ${filter}
    order by
      case d.status
        when 'open' then 0
        when 'matched' then 1
        when 'settled' then 2
        else 3
      end,
      d.join_deadline_at asc
    limit 100
  `);
}
