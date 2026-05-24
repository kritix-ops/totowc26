import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getProfileStats, getMyHistory } from "@/db/queries";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { localePath } from "@/lib/paths";

export default async function ProfilePage({
  params,
}: PageProps<"/[lang]/profile">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [[profile], stats, history] = await Promise.all([
    db
      .select({ displayName: profiles.displayName, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
    getProfileStats(user.id),
    getMyHistory(user.id, 10),
  ]);

  const isHebrew = locale === "he";
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  const displayName = profile?.displayName ?? (user.email ?? "");
  const initials = displayName.charAt(0).toUpperCase();
  const memberSinceLabel = stats.memberSince
    ? new Intl.DateTimeFormat(isHebrew ? "he-IL" : "en-GB", {
        month: "short",
        year: "numeric",
      }).format(new Date(stats.memberSince))
    : "—";

  const statBlocks = [
    { label: dict.profile.totalPoints, value: stats.totalPoints, primary: true },
    { label: dict.profile.exactScoreAccuracy, value: `${stats.exactAccuracy}%` },
    { label: dict.profile.outcomeAccuracy, value: `${stats.outcomeAccuracy}%` },
    { label: dict.profile.streak, value: stats.streak },
  ];

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-8 md:gap-10 max-w-3xl mx-auto w-full">
      <header className="flex items-center gap-4 md:gap-6">
        <div
          className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-primary text-on-primary flex items-center justify-center text-3xl md:text-4xl font-bold ring-2 ring-tertiary-fixed-dim shrink-0"
          aria-hidden
        >
          {initials}
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-[26px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-on-surface truncate">
            {displayName}
          </h1>
          <p className="text-sm md:text-base text-on-surface-variant">
            {dict.profile.memberSince} {memberSinceLabel}
          </p>
          {profile?.role === "admin" && (
            <p className="text-xs font-bold text-tertiary">
              {isHebrew ? "אדמין" : "Admin"}
            </p>
          )}
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <SectionHeading>{dict.profile.stats}</SectionHeading>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {statBlocks.map((s) => (
            <Card key={s.label} className="p-4 md:p-5 text-center">
              <LabelCaps as="div" className="mb-2">{s.label}</LabelCaps>
              <div
                className={`font-[family-name:var(--font-display)] text-2xl md:text-[28px] leading-none font-bold ${
                  s.primary ? "text-primary" : "text-on-surface"
                }`}
              >
                <span className="bidi-ltr">{s.value}</span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>{dict.profile.history}</SectionHeading>
        {history.length === 0 ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {isHebrew ? "אין עדיין הימורים בהיסטוריה" : "No bets yet"}
          </Card>
        ) : (
          <ul className="flex flex-col gap-2 md:gap-3">
            {history.map((h) => {
              const isFinal = h.status === "final";
              const homeName = isHebrew ? h.homeNameHe : h.homeNameEn;
              const awayName = isHebrew ? h.awayNameHe : h.awayNameEn;
              return (
                <Link
                  key={h.matchId}
                  href={localePath(locale, `match/${h.matchId}`)}
                  className="block"
                >
                  <Card className="p-3 md:p-4 flex items-center gap-3 md:gap-4 hover:bg-surface-container transition-colors">
                    <div className="flex items-center gap-1 md:gap-2 flex-1 min-w-0">
                      <Flag code={h.homeCode} size={24} />
                      <span className="text-xs md:text-sm font-bold truncate">{homeName}</span>
                      <span className="text-on-surface-variant text-xs px-0.5">vs</span>
                      <span className="text-xs md:text-sm font-bold truncate">{awayName}</span>
                      <Flag code={h.awayCode} size={24} />
                    </div>
                    {isFinal && h.homeScore !== null && h.awayScore !== null ? (
                      <>
                        <span className="font-[family-name:var(--font-score)] text-sm md:text-base font-bold bidi-ltr">
                          {h.homeScore} - {h.awayScore}
                        </span>
                        <span
                          className={`font-[family-name:var(--font-label)] text-xs font-bold bidi-ltr min-w-[40px] text-end ${
                            (h.pointsEarned ?? 0) > 0 ? "text-secondary" : "text-on-surface-variant"
                          }`}
                        >
                          +{h.pointsEarned ?? 0}
                        </span>
                      </>
                    ) : (
                      <span className="font-[family-name:var(--font-label)] text-xs text-on-surface-variant whitespace-nowrap">
                        {h.myHome !== null
                          ? `${h.myHome}-${h.myAway}`
                          : isHebrew ? "ללא הימור" : "no bet"}
                      </span>
                    )}
                    <Chev className="h-4 w-4 text-outline shrink-0" />
                  </Card>
                </Link>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>{dict.profile.settings}</SectionHeading>
        <Card className="p-0 overflow-hidden">
          <SettingRow
            label={dict.profile.language}
            value={isHebrew ? "עברית" : "English"}
            isHebrew={isHebrew}
          />
          <SettingRow
            label={isHebrew ? "התראות" : "Notifications"}
            value={isHebrew ? "מופעל" : "On"}
            isHebrew={isHebrew}
          />
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full min-h-[56px] flex items-center justify-between gap-3 px-5 py-4 text-error hover:bg-error-container transition-colors"
            >
              <span className="font-bold">{dict.profile.logout}</span>
              <LogOut className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </form>
        </Card>
      </section>
    </section>
  );
}

function SettingRow({
  label,
  value,
  isHebrew,
}: {
  label: string;
  value: string;
  isHebrew: boolean;
}) {
  const Chev = isHebrew ? ChevronLeft : ChevronRight;
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-outline-variant last:border-0 min-h-[56px]">
      <span className="font-bold text-on-surface">{label}</span>
      <span className="inline-flex items-center gap-1 text-on-surface-variant">
        {value}
        <Chev className="h-4 w-4" />
      </span>
    </div>
  );
}
