import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Swords } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../../dictionaries";
import { Card, Chip, LabelCaps, SectionHeading } from "@/components/ui";
import { PayGateBanner } from "@/components/PayGateBanner";
import { getRequestUser } from "@/lib/request-user";
import { getUserAccess } from "@/lib/access";
import { isAdmin } from "@/lib/admin";
import { execFirstRow } from "@/db/helpers";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { serverNow } from "@/lib/server-now";
import { DuelActions } from "./DuelActions";

type PageParams = {
  params: Promise<{ lang: string; id: string }>;
};

type DuelDetail = {
  id: string;
  status: "open" | "matched" | "settled" | "cancelled";
  scope: "match" | "day" | "tournament";
  stake: number;
  openerId: string;
  joinerId: string | null;
  openerAnswer: boolean;
  openerName: string;
  joinerName: string | null;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  joinDeadlineAt: string;
  resolveAt: string;
  resolvedValue: boolean | null;
  matchLabel: string | null;
  matchdayDate: string | null;
};

export default async function DuelDetailPage({ params }: PageParams) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);
  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));
  const access = await getUserAccess(user.id);
  const admin = await isAdmin(user.id);

  const duel = await loadDuel(id);
  if (!duel) notFound();

  const iAmOpener = duel.openerId === user.id;
  const winnerName =
    duel.status === "settled" && duel.resolvedValue !== null
      ? duel.resolvedValue === duel.openerAnswer
        ? duel.openerName
        : duel.joinerName
      : null;

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "duels")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface w-fit"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {dict.duels.title}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-start gap-3">
          <Swords className="h-6 w-6 md:h-8 md:w-8 mt-1 shrink-0" strokeWidth={1.75} />
          <span>{isHebrew ? duel.questionHe : duel.questionEn}</span>
        </h1>
        <p className="text-sm text-on-surface-variant">
          {isHebrew ? duel.gradingRuleHe : duel.gradingRuleEn}
        </p>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Chip>{scopeLabel(duel.scope, dict)}</Chip>
          {duel.matchLabel && (
            <Chip className="bidi-ltr">{duel.matchLabel}</Chip>
          )}
          <Chip tone={statusTone(duel.status)}>
            {statusLabel(duel.status, dict)}
          </Chip>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Side
            label={dict.duels.openerLabel}
            name={duel.openerName}
            answer={duel.openerAnswer}
            stake={duel.stake}
            isWinner={duel.status === "settled" && duel.resolvedValue === duel.openerAnswer}
            dict={dict}
          />
          <Side
            label={dict.duels.joinerLabel}
            name={duel.joinerName ?? "-"}
            answer={duel.joinerName ? !duel.openerAnswer : null}
            stake={duel.stake}
            isWinner={
              duel.status === "settled" &&
              duel.joinerName !== null &&
              duel.resolvedValue !== duel.openerAnswer
            }
            dict={dict}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 text-xs text-on-surface-variant border-t border-outline-variant pt-3">
          <span>
            <span className="font-bold">{dict.duels.deadlineLabel}:</span>{" "}
            {formatDateTime(duel.joinDeadlineAt, locale, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span>
            <span className="font-bold">{dict.duels.resolveAtLabel}:</span>{" "}
            {formatDateTime(duel.resolveAt, locale, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        {winnerName && (
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-outline-variant">
            <SectionHeading underline="thin" as="h2">
              {dict.duels.winnerLabel}
            </SectionHeading>
            <span className="font-[family-name:var(--font-display)] text-xl font-bold text-secondary">
              {winnerName}
            </span>
          </div>
        )}
      </Card>

      <DuelActions
        locale={locale}
        dict={dict}
        duelId={duel.id}
        status={duel.status}
        iAmOpener={iAmOpener}
        isAdmin={admin}
        canEdit={access.canEdit}
        joinDeadlinePassed={new Date(duel.joinDeadlineAt).getTime() <= serverNow()}
      />
    </section>
  );
}

function Side({
  label,
  name,
  answer,
  stake,
  isWinner,
  dict,
}: {
  label: string;
  name: string;
  answer: boolean | null;
  stake: number;
  isWinner: boolean;
  dict: Awaited<ReturnType<typeof getDictionary>>;
}) {
  return (
    <div
      className={
        "flex flex-col gap-2 p-3 rounded-lg border " +
        (isWinner
          ? "border-secondary bg-secondary-container/50"
          : "border-outline-variant bg-surface-container-low")
      }
    >
      <LabelCaps>{label}</LabelCaps>
      <span className="font-[family-name:var(--font-display)] text-lg font-bold truncate">
        {name}
      </span>
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-xs text-on-surface-variant">
          {dict.duels.yourAnswer}
        </span>
        <span className="text-sm font-bold">
          {answer === null ? "-" : answer ? dict.duels.yes : dict.duels.no}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-on-surface-variant">
          {dict.duels.stakeLabel}
        </span>
        <span className="font-[family-name:var(--font-score)] text-lg font-bold tabular-nums">
          {stake}
        </span>
      </div>
    </div>
  );
}

function scopeLabel(
  scope: DuelDetail["scope"],
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
  status: DuelDetail["status"],
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
  status: DuelDetail["status"],
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

async function loadDuel(id: string): Promise<DuelDetail | null> {
  // Validate UUID shape before interpolating into SQL. The query already
  // parameter-binds the value, but a non-UUID input would throw at the
  // cast - returning null instead is cleaner for the notFound() path.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return execFirstRow<DuelDetail>(sql`
    select
      d.id::text                                                as "id",
      d.status::text                                            as "status",
      d.scope::text                                             as "scope",
      d.stake                                                   as "stake",
      d.opener_id::text                                         as "openerId",
      d.joiner_id::text                                         as "joinerId",
      d.opener_answer                                           as "openerAnswer",
      po.display_name                                           as "openerName",
      pj.display_name                                           as "joinerName",
      d.question_he                                             as "questionHe",
      d.question_en                                             as "questionEn",
      d.grading_rule_he                                         as "gradingRuleHe",
      d.grading_rule_en                                         as "gradingRuleEn",
      d.join_deadline_at::text                                  as "joinDeadlineAt",
      d.resolve_at::text                                        as "resolveAt",
      d.resolved_value                                          as "resolvedValue",
      case when m.id is not null
           then m.home_team || ' vs ' || m.away_team
           else null end                                        as "matchLabel",
      md.date::text                                             as "matchdayDate"
    from public.duels d
    join public.profiles po on po.id = d.opener_id
    left join public.profiles pj on pj.id = d.joiner_id
    left join public.matches m on m.id = d.match_id
    left join public.matchdays md on md.id = d.matchday_id
    where d.id = ${id}::uuid
    limit 1
  `);
}
