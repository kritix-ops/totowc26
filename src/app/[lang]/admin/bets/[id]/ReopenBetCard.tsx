"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, RotateCw } from "lucide-react";
import { Card, PillButton } from "@/components/ui";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import type { Locale } from "../../../dictionaries";
import { usePendingAction } from "@/lib/use-pending-action";
import { reopenCustomBet } from "../actions";

// Admin "reopen for filling". Shown on a reversed bet that still has time on
// the clock (the parent page does the status + lock_at gate via canReopen, so
// this component only renders when reopening is actually possible). One click
// flips the bet back to 'open' so the remaining players can fill — the recovery
// path for a grade-then-reverse done by mistake before kickoff.
export function ReopenBetCard({
  locale,
  betId,
}: {
  locale: Locale;
  betId: string;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { pending, run } = usePendingAction();

  const onReopen = () => {
    if (
      !window.confirm(
        isHebrew
          ? "להחזיר את ההימור לפתוח? שחקנים יוכלו שוב למלא כל עוד לא ננעל."
          : "Reopen this bet? Players will be able to fill again until it locks.",
      )
    ) {
      return;
    }
    setError(null);
    void run(async () => {
      const res = await reopenCustomBet(betId);
      if (!res.ok) {
        setError(translateError(res.error, isHebrew));
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4 border-2 border-secondary/40">
      <div className="flex items-center gap-2">
        <RotateCw className="h-5 w-5 text-secondary" strokeWidth={1.75} />
        <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface">
          {isHebrew ? "החזר למילוי" : "Reopen for filling"}
        </h2>
      </div>

      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "ההימור הוחזר (reversed) ולכן סגור לשחקנים. המשחק עוד לא התחיל — אפשר להחזיר אותו לפתוח כדי שכולם יוכלו למלא. מי שכבר ניחש שומר על הניחוש."
          : "This bet was reversed, so it is closed to players. The match has not started yet — reopen it so everyone can fill. Existing picks are kept."}
      </p>

      {error && (
        <p className="inline-flex items-center gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {error}
        </p>
      )}
      {done && !error && (
        <p className="inline-flex items-center gap-2 text-sm text-secondary">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew
            ? "ההימור נפתח מחדש. שחקנים יכולים למלא."
            : "Reopened. Players can fill now."}
        </p>
      )}

      <div className="flex flex-col-reverse md:flex-row md:justify-end gap-3">
        <PillButton
          type="button"
          disabled={pending}
          onClick={onReopen}
          className="min-h-[48px]"
        >
          <RotateCw className="h-4 w-4" strokeWidth={2.5} />
          {pending
            ? isHebrew
              ? "מחזיר…"
              : "Reopening…"
            : isHebrew
              ? "החזר למילוי"
              : "Reopen for filling"}
        </PillButton>
      </div>
    </Card>
  );
}

const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  forbidden: ["אין הרשאה", "Not allowed"],
  bet_not_found: ["ההימור לא נמצא", "Bet not found"],
  invalid_status: [
    "אפשר להחזיר רק הימור שהוחזר (reversed)",
    "Only a reversed bet can be reopened",
  ],
  no_time_left: [
    "אין יותר זמן — ההימור כבר ננעל",
    "No time left — the bet has already locked",
  ],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(err: string, isHebrew: boolean): string {
  return translateAdminError(err, ERROR_MAP, isHebrew);
}
