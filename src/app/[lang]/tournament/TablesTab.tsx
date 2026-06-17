import { getLiveStandings, type LiveGroup } from "@/db/queries";
import { getFormByCode } from "@/lib/stats";
import { getDictionary, type Locale } from "../dictionaries";
import { LiveStandings } from "./LiveStandings";
import { settle } from "./safe";

// Full live group standings. Thin wrapper around <LiveStandings/> so the
// page.tsx server component can keep its tab dispatch flat. Hits both our
// own DB (authoritative for points / GD / etc.) and API-Football (for the
// 5-match form string that we don't compute locally).

export async function TablesTab({ locale }: { locale: Locale }) {
  const [groups, formByCode, dict] = await Promise.all([
    settle<LiveGroup[]>("tables:standings", [], () => getLiveStandings()),
    settle<Map<string, string>>("tables:form", new Map(), () => getFormByCode()),
    getDictionary(locale),
  ]);
  return (
    <LiveStandings
      groups={groups}
      locale={locale}
      formByCode={formByCode}
      formHeading={dict.tournament.formHeading}
      formTooltip={dict.tournament.formTooltip}
      formNone={dict.tournament.formNone}
    />
  );
}
