"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SearchableChoicePicker } from "@/components/SearchableChoicePicker";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { AdminBetMatchOption } from "@/db/admin-queries";

// Structured "filter to one fixture" control for /admin/bets. The page
// stays a server component that reads `?match=<id>` and passes it to
// listCustomBets(); this island owns the searchable dropdown and writes
// the selection back into the URL while preserving every other filter
// (status, scope, q). Picking the same fixture twice is idempotent;
// clearing removes the param so the list returns to all matches.

export function BetsMatchFilter({
  locale,
  matches,
  currentMatchId,
}: {
  locale: Locale;
  matches: AdminBetMatchOption[];
  currentMatchId: string | null;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const searchParams = useSearchParams();

  // Build "USA vs PAR" labels in both locales so the picker's internal
  // search matches a Hebrew or English team name as well as the codes.
  // The bet-count subtitle tells the admin how many questions sit behind
  // each fixture before they commit to the filter.
  const options = matches.map((m) => {
    const vsHe = "נגד";
    const countHe = `${m.betCount} ${m.betCount === 1 ? "הימור" : "הימורים"}`;
    const countEn = `${m.betCount} ${m.betCount === 1 ? "bet" : "bets"}`;
    return {
      value: m.matchId,
      labelHe: `${m.homeCode} ${vsHe} ${m.awayCode} · ${m.homeNameHe} / ${m.awayNameHe}`,
      labelEn: `${m.homeCode} vs ${m.awayCode} · ${m.homeNameEn} / ${m.awayNameEn}`,
      subtitleHe: countHe,
      subtitleEn: countEn,
    };
  });

  const apply = (matchId: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (matchId) next.set("match", matchId);
    else next.delete("match");
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  return (
    <SearchableChoicePicker
      options={options}
      currentValue={currentMatchId}
      locale={locale}
      onChange={apply}
      placeholder={isHebrew ? "כל המשחקים" : "All matches"}
      lazyChunkSize={20}
    />
  );
}
