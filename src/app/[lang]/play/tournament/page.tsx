import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";

// Tournament bets moved to /bets/tournament under the unified bets
// surface (Match picks / Tournament / Group rankings). This redirect
// keeps existing links + deep links working through the cutover.
export default async function PlayTournamentRedirect({
  params,
}: PageProps<"/[lang]/play/tournament">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  redirect(localePath(locale, "bets/tournament"));
}
