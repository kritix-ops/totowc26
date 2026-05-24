import { notFound, redirect } from "next/navigation";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { getUser } from "@/lib/supabase/auth";
import { getBracketPredictions, getAllTeams } from "@/db/queries";
import { localePath } from "@/lib/paths";
import { BracketEditor } from "./BracketEditor";

export default async function BracketPage({
  params,
}: PageProps<"/[lang]/bracket">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [picks, teams] = await Promise.all([
    getBracketPredictions(user.id),
    getAllTeams(),
  ]);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-10 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[48px] md:leading-[52px] font-bold text-primary">
          {dict.bracket.title}
        </h1>
        <p className="text-base text-on-surface-variant">{dict.bracket.subtitle}</p>
      </header>
      <BracketEditor picks={picks} teams={teams} locale={locale} dict={dict} />
    </section>
  );
}
