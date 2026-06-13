"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Megaphone,
  ChevronDown,
  Send,
  Check,
  AlertCircle,
} from "lucide-react";
import { clsx } from "clsx";
import { Card, LabelCaps, PillButton } from "@/components/ui";
import type { Locale } from "../../dictionaries";
import { usePendingAction } from "@/lib/use-pending-action";
import { buildLiveBetPushText } from "@/lib/bets/live-bet-push";
import { sendLiveBetPush } from "./actions";

// One selectable open live bet, with its anchor already resolved server-
// side (same liveBetAnchor path the action uses) so the live preview and
// the sent push can never drift.
export type LiveBetPushItem = {
  id: string;
  question: string;
  anchorKey: string;
  anchorLabel: string;
};

// The push composer that lives at the top of the live-bets management
// view. Lets a manager tick one or more freshly-published live bets and
// fire a single "match name + count" push to every push-opted-in player.
// Manual / batch only — there is no auto-on-publish path.
export function LiveBetPushComposer({
  locale,
  items,
}: {
  locale: Locale;
  items: LiveBetPushItem[];
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const { pending, run } = usePendingAction();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [sentFlash, setSentFlash] = useState<{ recipients: number } | null>(
    null,
  );

  // Group items by anchor so the list reads "match → its bets", with a
  // per-match select-all. Preserves the server's anchor order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<
      string,
      { label: string; items: LiveBetPushItem[] }
    >();
    for (const it of items) {
      const g = byKey.get(it.anchorKey);
      if (g) {
        g.items.push(it);
      } else {
        byKey.set(it.anchorKey, { label: it.anchorLabel, items: [it] });
        order.push(it.anchorKey);
      }
    }
    return order.map((k) => ({ key: k, ...byKey.get(k)! }));
  }, [items]);

  // Live preview — one anchor entry per selected bet, then the same pure
  // builder the server uses.
  const preview = useMemo(() => {
    const anchors = items
      .filter((it) => selected.has(it.id))
      .map((it) => ({ key: it.anchorKey, label: it.anchorLabel }));
    return buildLiveBetPushText(anchors, isHebrew ? "he" : "en");
  }, [items, selected, isHebrew]);

  const toggle = (id: string) => {
    setSentFlash(null);
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (key: string) => {
    setSentFlash(null);
    setError(null);
    const group = groups.find((g) => g.key === key);
    if (!group) return;
    const ids = group.items.map((i) => i.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const clear = () => {
    setSelected(new Set());
    setSentFlash(null);
    setError(null);
  };

  const send = () => {
    setError(null);
    setSentFlash(null);
    if (selected.size === 0) return;
    void run(async () => {
      const res = await sendLiveBetPush(
        [...selected],
        isHebrew ? "he" : "en",
      );
      if (!res.ok) {
        setError(
          res.error === "forbidden"
            ? isHebrew
              ? "אין הרשאה"
              : "Not allowed"
            : res.error === "no_valid_bets"
              ? isHebrew
                ? "ההימורים שנבחרו כבר לא פתוחים"
                : "The selected bets are no longer open"
              : isHebrew
                ? "השליחה נכשלה"
                : "Send failed",
        );
        return;
      }
      setSentFlash({ recipients: res.recipients });
      setSelected(new Set());
      router.refresh();
    });
  };

  const availableCount = items.length;
  const selectedCount = selected.size;

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 md:p-5 text-start min-h-[56px]"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Megaphone className="h-5 w-5 text-primary shrink-0" strokeWidth={2} />
          <span className="flex flex-col min-w-0">
            <span className="font-bold text-on-surface">
              {isHebrew ? "שלח פוש על הימורי לייב" : "Push live bets to players"}
            </span>
            <span className="text-xs text-on-surface-variant">
              {availableCount === 0
                ? isHebrew
                  ? "אין כרגע הימורי לייב פתוחים"
                  : "No open live bets right now"
                : isHebrew
                  ? `${availableCount} הימורי לייב פתוחים · בחר ושלח פוש אחד`
                  : `${availableCount} open live bets · pick and send one push`}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {selectedCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full bg-primary text-on-primary text-xs font-bold tabular-nums">
              {selectedCount}
            </span>
          )}
          <ChevronDown
            className={clsx(
              "h-5 w-5 text-on-surface-variant transition-transform",
              open && "rotate-180",
            )}
            strokeWidth={2}
          />
        </span>
      </button>

      {open && (
        <div className="px-4 md:px-5 pb-4 md:pb-5 flex flex-col gap-4 border-t border-outline-variant pt-4">
          {availableCount === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-2">
              {isHebrew
                ? "פרסם הימור לייב כדי שתוכל לשלוח עליו פוש."
                : "Publish a live bet to be able to push it."}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {groups.map((g) => {
                  const ids = g.items.map((i) => i.id);
                  const allOn = ids.every((id) => selected.has(id));
                  const someOn = ids.some((id) => selected.has(id));
                  return (
                    <div
                      key={g.key}
                      className="rounded-lg border border-outline-variant overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.key)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-surface-container-low text-start min-h-[44px]"
                      >
                        <span className="font-bold text-sm text-on-surface truncate">
                          {g.label}
                        </span>
                        <span
                          className={clsx(
                            "inline-flex items-center justify-center h-6 px-2 rounded-full text-xs font-bold shrink-0",
                            allOn
                              ? "bg-primary text-on-primary"
                              : someOn
                                ? "bg-primary-fixed text-on-primary-fixed-variant"
                                : "bg-surface-variant text-on-surface-variant",
                          )}
                        >
                          {allOn
                            ? isHebrew
                              ? "הכל נבחר"
                              : "All"
                            : `${g.items.filter((i) => selected.has(i.id)).length}/${g.items.length}`}
                        </span>
                      </button>
                      <ul className="divide-y divide-outline-variant">
                        {g.items.map((it) => {
                          const on = selected.has(it.id);
                          return (
                            <li key={it.id}>
                              <button
                                type="button"
                                onClick={() => toggle(it.id)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-start min-h-[44px] hover:bg-surface-container-low"
                              >
                                <span
                                  className={clsx(
                                    "inline-flex items-center justify-center h-5 w-5 rounded border-2 shrink-0",
                                    on
                                      ? "bg-primary border-primary text-on-primary"
                                      : "border-outline bg-surface-container-lowest",
                                  )}
                                >
                                  {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                </span>
                                <span className="text-sm text-on-surface truncate">
                                  {it.question}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>

              {/* Live preview of exactly what players will receive. */}
              {preview && (
                <div className="rounded-lg bg-surface-container-low border border-outline-variant p-3 flex flex-col gap-1">
                  <LabelCaps>{isHebrew ? "תצוגה מקדימה" : "Preview"}</LabelCaps>
                  <p className="font-bold text-sm text-on-surface">
                    {preview.title}
                  </p>
                  <p className="text-sm text-on-surface-variant whitespace-pre-line">
                    {preview.body}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-h-[24px]">
                  {selectedCount > 0 && (
                    <button
                      type="button"
                      onClick={clear}
                      className="text-sm text-on-surface-variant underline"
                    >
                      {isHebrew ? "נקה בחירה" : "Clear"}
                    </button>
                  )}
                  {error && (
                    <span className="inline-flex items-center gap-1 text-xs text-error">
                      <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
                      {error}
                    </span>
                  )}
                  {sentFlash && !error && (
                    <span className="inline-flex items-center gap-1 text-xs text-secondary">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                      {isHebrew
                        ? `נשלח ל-${sentFlash.recipients} שחקנים`
                        : `Sent to ${sentFlash.recipients} players`}
                    </span>
                  )}
                </div>
                <PillButton
                  type="button"
                  onClick={send}
                  disabled={pending || selectedCount === 0}
                  className={clsx(
                    "min-h-[48px]",
                    (pending || selectedCount === 0) &&
                      "opacity-60 cursor-not-allowed",
                  )}
                >
                  <Send className="h-4 w-4" strokeWidth={2.5} />
                  {pending
                    ? isHebrew
                      ? "שולח..."
                      : "Sending..."
                    : isHebrew
                      ? `שלח פוש${selectedCount > 0 ? ` (${selectedCount})` : ""}`
                      : `Send push${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
                </PillButton>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
