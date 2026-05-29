"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Check, AlertCircle, Shield } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import type { ViewAsRole } from "@/lib/view-as";
import { usePendingAction } from "@/lib/use-pending-action";
import { setViewAs, clearViewAs } from "./view-as-actions";

export function ViewAsPanel({
  locale,
  current,
}: {
  locale: Locale;
  current: ViewAsRole | null;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = usePendingAction();
  const [pendingTarget, setPendingTarget] = useState<ViewAsRole | "clear" | null>(
    null,
  );

  const apply = (target: ViewAsRole | "clear") => {
    setError(null);
    setPendingTarget(target);
    void run(async () => {
      const res =
        target === "clear" ? await clearViewAs() : await setViewAs(target);
      setPendingTarget(null);
      if (!res.ok) {
        setError(
          res.error === "forbidden"
            ? isHebrew
              ? "אין הרשאה"
              : "Not allowed"
            : isHebrew
              ? "לא מחובר"
              : "Not signed in",
        );
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "צפייה כמשתתף" : "View as player"}
          </SectionHeading>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "הצג את האפליקציה כאילו אתה משתתף רגיל. שימושי לבדוק איך זה נראה ופועל בצד של המשתתף. שמירת הימורים תיכשל בדיוק כמו אצל משתתף שלא שילם."
              : "Render the app as if you were a regular player. Useful for previewing the player experience. Bet saves will fail exactly like they do for unpaid players."}
          </p>
        </div>
        <CurrentBadge current={current} isHebrew={isHebrew} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3">
        <RoleButton
          active={current === null}
          pending={pending && pendingTarget === "clear"}
          onClick={() => apply("clear")}
          icon={<Shield className="h-4 w-4" strokeWidth={2} />}
          title={isHebrew ? "אדמין" : "Admin"}
          subtitle={isHebrew ? "תצוגה רגילה" : "Default view"}
        />
        <RoleButton
          active={current === "paid"}
          pending={pending && pendingTarget === "paid"}
          onClick={() => apply("paid")}
          icon={<Check className="h-4 w-4" strokeWidth={2.5} />}
          title={isHebrew ? "משתתף ששילם" : "Paid player"}
          subtitle={isHebrew ? "כל המסכים פעילים" : "All actions enabled"}
        />
        <RoleButton
          active={current === "unpaid"}
          pending={pending && pendingTarget === "unpaid"}
          onClick={() => apply("unpaid")}
          icon={<Eye className="h-4 w-4" strokeWidth={2} />}
          title={isHebrew ? "משתתף שלא שילם" : "Unpaid player"}
          subtitle={isHebrew ? "צפייה בלבד + באנר" : "Read-only + gate banner"}
        />
      </div>

      {error && (
        <p className="inline-flex items-center gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {error}
        </p>
      )}
    </Card>
  );
}

function CurrentBadge({
  current,
  isHebrew,
}: {
  current: ViewAsRole | null;
  isHebrew: boolean;
}) {
  const label = current
    ? current === "paid"
      ? isHebrew
        ? "צופה כמשולם"
        : "Viewing as paid"
      : isHebrew
        ? "צופה כלא משולם"
        : "Viewing as unpaid"
    : isHebrew
      ? "מצב אדמין"
      : "Admin mode";
  const tone =
    current === null
      ? "bg-surface-container-low text-on-surface-variant border-outline-variant"
      : "bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border",
        tone,
      )}
    >
      <Eye className="h-3.5 w-3.5" strokeWidth={2} />
      <LabelCaps>{label}</LabelCaps>
    </span>
  );
}

function RoleButton({
  active,
  pending,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  pending: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={active || pending}
      className={clsx(
        "press-down min-h-[64px] py-3 px-4 rounded-lg border text-start flex items-start gap-3 transition-colors",
        active
          ? "border-2 border-primary bg-primary-container text-on-primary-container shadow-sm cursor-default"
          : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container",
        pending && "opacity-70 cursor-wait",
      )}
    >
      <span
        className={clsx(
          "shrink-0 mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full",
          active
            ? "bg-primary text-on-primary"
            : "bg-surface-container-high text-on-surface-variant",
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="font-bold text-sm md:text-base leading-tight">
          {title}
        </span>
        <span className="text-xs text-on-surface-variant leading-tight">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
