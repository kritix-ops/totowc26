"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { Card, PillButton } from "@/components/ui";

// Route-level error boundary for /he/bets/[matchId].
//
// The match-detail page does a Promise.all of six queries (match,
// myBet, access, deadlineContext, lock overrides, scoring, bank
// balance). Any one of them throwing previously blanked the whole
// page. Same agent-blind-spot pattern as /me/bank. Vercel logs hold
// the digest stack; users see a clear retry surface.

export default function MatchBetErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[bets/matchId error boundary]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 max-w-3xl mx-auto w-full pb-24 md:pb-12">
      <Card className="p-6 md:p-8 flex flex-col gap-4 items-center text-center">
        <AlertCircle className="h-10 w-10 text-error" strokeWidth={1.5} />
        <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold text-on-surface">
          לא הצלחנו לטעון את המשחק
        </h1>
        <p className="text-base text-on-surface-variant max-w-md">
          משהו השתבש בטעינת פרטי המשחק. נסה לרענן או חזור לרשימת ההימורים.
        </p>
        {error.digest && (
          <p className="text-xs text-on-surface-variant font-mono">
            error: {error.digest}
          </p>
        )}
        <PillButton onClick={reset} className="inline-flex items-center gap-2">
          <RotateCw className="h-4 w-4" strokeWidth={2} />
          נסה שוב
        </PillButton>
      </Card>
    </section>
  );
}
