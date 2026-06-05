"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { Card, PillButton } from "@/components/ui";

// Route-level error boundary for /he/profile.
//
// The profile page runs a large Promise.all (profile row, profile
// stats, four pick-history bucket queries, unread-notifications
// count, settings row). Any throw blanked the whole page. The QA
// agent's 2026-06-05 14:21 auth-flow run caught it. Same pattern
// as /me/bank and /bets/[matchId]: error.tsx + per-query wraps.

export default function ProfileErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[profile error boundary]", {
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
          לא הצלחנו לטעון את הפרופיל
        </h1>
        <p className="text-base text-on-surface-variant max-w-md">
          משהו השתבש בטעינת הפרופיל שלך. ניסיון נוסף בדרך כלל פותר את זה.
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
