"use client";

import { useTransition } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { clsx } from "clsx";
import { Card, LabelCaps } from "@/components/ui";
import type { Locale } from "../../../dictionaries";
import { setTemplateArchived } from "../actions";

// Small admin-only control: flip a custom_bet's template_archived flag
// so it stops appearing in the template picker / quick-add chip strips.
// Mounted on the bet detail page below the grading rule. Player-facing
// surfaces ignore the flag entirely — only the admin authoring flows
// read it. See migration 0049 + setTemplateArchived in ../actions.ts.

export function TemplateArchiveCard({
  betId,
  archived,
  locale,
}: {
  betId: string;
  archived: boolean;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      const res = await setTemplateArchived(betId, !archived);
      if (!res.ok) {
        // Best-effort surface; the detail page revalidates on success
        // anyway, so the only path here is a real DB / permission
        // failure — uncommon enough that an alert is fine.
        alert(isHebrew ? "פעולה נכשלה" : "Action failed");
      }
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-2">
      <LabelCaps>
        {isHebrew ? "הוספה מהירה / טמפלטים" : "Quick add / templates"}
      </LabelCaps>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-on-surface-variant flex-1 min-w-0">
          {archived
            ? isHebrew
              ? "השאלה מוסתרת ממסך 'הוספה מהירה' ומה-dropdown של הטמפלטים. אפשר להחזיר בכל רגע."
              : "Hidden from the quick-add page and the template dropdown. You can un-hide at any time."
            : isHebrew
              ? "השאלה זמינה כטמפלט להוספה מהירה למשחקים וימים עתידיים. אם היא לא רלוונטית יותר, ארכב כאן."
              : "Available as a template on quick-add and the dropdown. Archive it if it stops being relevant."}
        </p>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={clsx(
            "press-down inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-full border text-sm font-bold transition-colors",
            archived
              ? "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container"
              : "border-error bg-surface-container-lowest text-error hover:bg-error-container",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {archived ? (
            <ArchiveRestore className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Archive className="h-4 w-4" strokeWidth={2} />
          )}
          {pending
            ? isHebrew ? "מעדכן…" : "Updating…"
            : archived
              ? isHebrew ? "החזר לפעיל" : "Un-archive"
              : isHebrew ? "ארכב טמפלט" : "Archive"}
        </button>
      </div>
    </Card>
  );
}
