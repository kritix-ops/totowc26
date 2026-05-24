import { notFound, redirect } from "next/navigation";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getGroupsWithPredictions } from "@/db/queries";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { GroupsEditor } from "./GroupsEditor";

export default async function StandingsPage({
  params,
}: PageProps<"/[lang]/standings">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const groups = await getGroupsWithPredictions(user.id);
  const isHebrew = locale === "he";

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-10 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {dict.standings.title}
        </h1>
        <p className="text-base text-on-surface-variant">{dict.standings.subtitle}</p>
      </header>

      {groups.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew ? "אין עדיין בתים" : "No groups yet"}
        </Card>
      ) : (
        <GroupsEditor groups={groups} locale={locale} dict={dict} />
      )}
    </section>
  );
}
