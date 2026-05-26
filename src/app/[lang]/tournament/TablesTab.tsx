import { getLiveStandings } from "@/db/queries";
import type { Locale } from "../dictionaries";
import { LiveStandings } from "./LiveStandings";

// Full live group standings. Thin wrapper around <LiveStandings/> so the
// page.tsx server component can keep its tab dispatch flat.

export async function TablesTab({ locale }: { locale: Locale }) {
  const groups = await getLiveStandings();
  return <LiveStandings groups={groups} locale={locale} />;
}
