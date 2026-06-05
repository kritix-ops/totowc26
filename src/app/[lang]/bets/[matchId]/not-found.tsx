import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { headers } from "next/headers";
import { Card } from "@/components/ui";

// not-found.tsx for /he/bets/[matchId]. Hit when the matchId segment
// is a syntactically-valid UUID that does not match any row in the DB
// (the upstream regex guard handles bad UUIDs separately). Previously
// the route fell back to the Next.js default 404 page, which renders
// no main content and looks blank in the QA agent's snapshot.

export default async function MatchNotFound() {
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  const isHebrew = pathname.startsWith("/he");
  const Chev = isHebrew ? ChevronRight : ChevronLeft;
  const backHref = isHebrew ? "/he/bets" : "/en/bets";

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 max-w-3xl mx-auto w-full pb-24 md:pb-12">
      <Card className="p-6 md:p-8 flex flex-col gap-4 items-center text-center">
        <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold text-on-surface">
          {isHebrew ? "המשחק לא נמצא" : "Match not found"}
        </h1>
        <p className="text-base text-on-surface-variant max-w-md">
          {isHebrew
            ? "המשחק הזה כבר לא קיים או שהמזהה שגוי. חזור לרשימת ההימורים ובחר משחק אחר."
            : "This match no longer exists or the id is invalid. Head back to the bets list and pick another one."}
        </p>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm font-bold text-primary min-h-[44px] px-4 py-2"
        >
          <Chev className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה להימורים" : "Back to bets"}
        </Link>
      </Card>
    </section>
  );
}
