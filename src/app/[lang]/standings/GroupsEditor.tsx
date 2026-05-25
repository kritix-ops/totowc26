"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Check, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import type { Dictionary, Locale } from "../dictionaries";
import { Card, Chip, LabelCaps, PillButton, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import type { GroupWithRanks } from "@/db/queries";
import { saveGroupOrder, type SaveGroupResult } from "./actions";

export function GroupsEditor({
  groups,
  locale,
  dict,
  canEdit,
}: {
  groups: GroupWithRanks[];
  locale: Locale;
  dict: Dictionary;
  canEdit: boolean;
}) {
  const isHebrew = locale === "he";

  // Local ordering per group, keyed by group id. Start with whatever
  // ordering the server gave us (already sorted by predictedRank).
  const [orderById, setOrderById] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const g of groups) map[g.id] = g.teams.map((t) => t.code);
    return map;
  });
  const [savedById, setSavedById] = useState<Record<string, boolean>>(() => {
    // A group is "saved" if all teams in it already have a predictedRank.
    const map: Record<string, boolean> = {};
    for (const g of groups) {
      map[g.id] = g.teams.every((t) => t.predictedRank !== null);
    }
    return map;
  });

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {groups.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            locale={locale}
            order={orderById[g.id]}
            saved={savedById[g.id]}
            isHebrew={isHebrew}
            dict={dict}
            canEdit={canEdit}
            onChange={(next) =>
              setOrderById((prev) => ({ ...prev, [g.id]: next }))
            }
            onSaved={() =>
              setSavedById((prev) => ({ ...prev, [g.id]: true }))
            }
          />
        ))}
      </div>
    </>
  );
}

function GroupCard({
  group,
  locale,
  order,
  saved,
  isHebrew,
  dict,
  canEdit,
  onChange,
  onSaved,
}: {
  group: GroupWithRanks;
  locale: Locale;
  order: string[];
  saved: boolean;
  isHebrew: boolean;
  dict: Dictionary;
  canEdit: boolean;
  onChange: (next: string[]) => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<
    Exclude<SaveGroupResult, { ok: true }>["error"] | null
  >(null);
  const [pending, startTransition] = useTransition();

  const byCode = new Map(group.teams.map((t) => [t.code, t]));

  const move = (idx: number, dir: -1 | 1) => {
    if (!canEdit) return;
    const next = [...order];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  const save = () => {
    if (!canEdit) return;
    setError(null);
    startTransition(async () => {
      const res = await saveGroupOrder(group.id, order);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <SectionHeading>
          {dict.standings.group} {group.id}
        </SectionHeading>
        <div className="flex items-center gap-2">
          {saved && (
            <Chip tone="secondary">
              <Check className="h-3.5 w-3.5" />
              {dict.standings.savedBadge}
            </Chip>
          )}
          <Chip tone="warning">{dict.standings.bonus}</Chip>
        </div>
      </div>

      <ol className="flex flex-col gap-2">
        {order.map((code, idx) => {
          const team = byCode.get(code);
          if (!team) return null;
          return (
            <li
              key={code}
              className="flex items-center gap-2 md:gap-3 px-2 md:px-3 py-2 rounded border border-outline-variant bg-surface-container-lowest"
            >
              <span className="font-[family-name:var(--font-label)] text-sm font-bold text-on-surface-variant bidi-ltr w-5 text-center">
                {idx + 1}
              </span>
              <Flag code={team.code} size={28} />
              <span className="text-sm md:text-base font-bold flex-1 truncate">
                {isHebrew ? team.nameHe : team.nameEn}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label={isHebrew ? "העלה" : "Move up"}
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0 || pending || !canEdit}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full hover:bg-surface-container disabled:opacity-30"
                >
                  <ChevronUp className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label={isHebrew ? "הורד" : "Move down"}
                  onClick={() => move(idx, 1)}
                  disabled={idx === order.length - 1 || pending || !canEdit}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full hover:bg-surface-container disabled:opacity-30"
                >
                  <ChevronDown className="h-5 w-5" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {error && (
        <p className="inline-flex items-center gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {error === "invalid"
            ? isHebrew ? "סדר לא תקין" : "Invalid ordering"
            : error === "unauth"
              ? isHebrew ? "יש להתחבר" : "Sign in required"
              : error === "not_paid"
                ? isHebrew
                  ? "תשלום עדיין לא אושר"
                  : "Payment not approved yet"
                : error === "insufficient_bank"
                  ? isHebrew
                    ? "אין מספיק נקודות בבנק"
                    : "Not enough points in your bank"
                  : isHebrew ? "שמירה נכשלה" : "Save failed"}
        </p>
      )}

      <PillButton
        type="button"
        onClick={save}
        disabled={pending || !canEdit}
        className={clsx(
          "w-full md:w-auto self-stretch md:self-end px-6 py-3 text-sm",
          pending && "opacity-70 cursor-wait",
          !canEdit && "opacity-60 cursor-not-allowed",
        )}
      >
        {pending
          ? isHebrew ? "שומר..." : "Saving..."
          : isHebrew ? "שמור בית" : "Save group"}
      </PillButton>
    </Card>
  );
}
