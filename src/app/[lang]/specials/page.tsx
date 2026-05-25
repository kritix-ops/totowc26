import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Trophy, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { specialBets } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { fetchTopScorers } from "@/lib/football-data";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { localePath } from "@/lib/paths";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { PayGateBanner } from "@/components/PayGateBanner";
import { SpecialsForm } from "./SpecialsForm";

export default async function SpecialsPage({
  params,
}: PageProps<"/[lang]/specials">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const isHebrew = locale === "he";
  const access = await getUserAccess(user.id);

  const picks = await db
    .select({ betType: specialBets.betType, value: specialBets.value })
    .from(specialBets)
    .where(eq(specialBets.userId, user.id));
  const topScorerPick = picks.find((p) => p.betType === "top_scorer")?.value ?? "";
  const finalPenaltiesPick = picks.find((p) => p.betType === "final_penalties")?.value ?? "";

  // Best-effort fetch of the API's current top-scorer leaderboard for
  // autocomplete suggestions. If the call fails (rate limit etc.) we fall
  // back to a free-text input.
  let scorerOptions: string[] = [];
  try {
    const scorers = await fetchTopScorers(2026, 30);
    scorerOptions = scorers
      .filter((s) => !!s.player?.name)
      .map((s) => s.player.name);
  } catch {
    // Silent fallback. The form still accepts free text.
  }

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {isHebrew ? "הימורי על" : "Tournament specials"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "ניחושים חד-פעמיים על כל הטורניר. נסגרים עם שריקת הפתיחה של המשחק הראשון."
            : "One-shot tournament picks. Lock at first kickoff."}
        </p>
      </header>

      {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Trophy className="h-6 w-6 text-tertiary-fixed-dim shrink-0" strokeWidth={1.75} />
            <SectionHeading as="h2" underline="thin">
              {isHebrew ? "מלך השערים" : "Top scorer"}
            </SectionHeading>
          </div>
          <LabelCaps>+20 {isHebrew ? "נק'" : "pts"}</LabelCaps>
        </div>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "השחקן שיסיים את הטורניר עם הכי הרבה שערים. תוכל לעדכן עד שריקת הפתיחה."
            : "Player who finishes the tournament with the most goals."}
        </p>
        <SpecialsForm
          slot="top_scorer"
          initialValue={topScorerPick}
          options={scorerOptions}
          locale={locale}
          canEdit={access.canEdit}
        />
      </Card>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="h-6 w-6 text-primary shrink-0" strokeWidth={1.75} />
            <SectionHeading as="h2" underline="thin">
              {isHebrew ? "האם הגמר ייפסק בפנדלים?" : "Will the final go to penalties?"}
            </SectionHeading>
          </div>
          <LabelCaps>+10 {isHebrew ? "נק'" : "pts"}</LabelCaps>
        </div>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "ניחוש פשוט. אם הגמר יסתיים בדו-קרב פנדלים, מי שניחש 'כן' מקבל."
            : "Simple call. If the final ends with a penalty shootout, anyone who picked 'Yes' wins."}
        </p>
        <SpecialsForm
          slot="final_penalties"
          initialValue={finalPenaltiesPick}
          locale={locale}
          canEdit={access.canEdit}
        />
      </Card>
    </section>
  );
}
