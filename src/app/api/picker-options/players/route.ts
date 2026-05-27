import { NextResponse, type NextRequest } from "next/server";
import { loadPlayersForPicker } from "@/db/queries";

// GET /api/picker-options/players?locale=he|en
//
// Hydrates the user-facing PlayerPicker. Returns the full WC roster
// (~1,357 rows) shaped as MultiChoiceOption[], already sorted with
// hand-curated stars first, then by team rank, then locale-alphabetical.
// Client caches in memory per (source, locale) so opening multiple bet
// pickers on the same page never re-fetches.
//
// No auth — player names are public WC squad data.
// Cache aggressively: rosters change at most once a day (squad sync /
// translation pipeline). 5 minute fresh, 15 minute stale-while-revalidate.
export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const rawLocale = request.nextUrl.searchParams.get("locale");
  const locale = rawLocale === "en" ? "en" : "he";

  try {
    const options = await loadPlayersForPicker(locale);
    const ms = Date.now() - t0;
    console.info("[picker-options players]", {
      locale,
      count: options.length,
      ms,
    });
    return NextResponse.json(
      { options },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[picker-options players] failed", { locale, error: msg });
    return NextResponse.json(
      { error: "failed_to_load_players" },
      { status: 500 },
    );
  }
}
