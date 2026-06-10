"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { Card, PillButton } from "@/components/ui";

// Root error boundary for the whole /[lang] segment.
//
// The home dashboard streams every section in its own <Suspense> but
// had no error boundary above them, so a single throw - e.g. a query
// referencing a column from a migration that had not reached the DB
// yet - blanked the entire page to Next's bare "server error" screen
// instead of degrading one card. The 2026-06-09 prod incident (the
// pool-digest section hitting a missing settings column before
// migration 0044 ran) was exactly this. This boundary keeps the app
// shell up, shows a clear retry, and writes the digest to the Vercel
// function logs. Child routes with their own error.tsx (/me/bank,
// /profile, /bets/[matchId]) still take precedence for their subtree.

export default function LangErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[lang error boundary]", {
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
          לא הצלחנו לטעון את העמוד
        </h1>
        <p className="text-base text-on-surface-variant max-w-md">
          משהו השתבש בטעינת העמוד. ניסיון נוסף בדרך כלל פותר את זה.
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
