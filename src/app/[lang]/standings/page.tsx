import { notFound, redirect } from "next/navigation";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { getGroupsWithPredictions, getLiveStandings } from "@/db/queries";
import { Card, SectionHeading } from "@/components/ui";
import { PayGateBanner } from "@/components/PayGateBanner";
import { localePath } from "@/lib/paths";
import { GroupsEditor } from "./GroupsEditor";
import { LiveStandings } from "./LiveStandings";

export default async function StandingsPage({
  params,
}: PageProps<"/[lang]/standings">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [predictionGroups, liveGroups, access] = await Promise.all([
    getGroupsWithPredictions(user.id),
    getLiveStandings(),
    getUserAccess(user.id),
  ]);
  const isHebrew = locale === "he";

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-8 md:gap-12 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {dict.standings.title}
        </h1>
        <p className="text-base text-on-surface-variant">{dict.standings.subtitle}</p>
      </header>

      <LiveStandings groups={liveGroups} locale={locale} />

      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "הניחוש שלך" : "Your prediction"}
          </SectionHeading>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "סדר את הנבחרות בכל בית כפי שאתה חוזה שיסיימו."
              : "Order each group the way you predict it will end."}
          </p>
        </header>
        {!access.canEdit && <PayGateBanner locale={locale} dict={dict} />}
        {predictionGroups.length === 0 ? (
          <Card className="p-6 text-center text-on-surface-variant">
            {isHebrew ? "אין עדיין בתים" : "No groups yet"}
          </Card>
        ) : (
          <GroupsEditor
            groups={predictionGroups}
            locale={locale}
            dict={dict}
            canEdit={access.canEdit}
          />
        )}
      </section>
    </section>
  );
}
