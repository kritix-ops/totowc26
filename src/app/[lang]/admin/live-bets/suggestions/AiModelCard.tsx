"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Cpu } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../../dictionaries";
import { Card, LabelCaps } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  SUGGEST_MODELS,
  DEFAULT_GENS_PER_MATCH,
  costPerCall,
  projectCost,
} from "@/lib/bets/suggest/models";
import { setSuggestModel, setAutogenConfig } from "./actions";

// Admin control: pick the Claude model the live-bet generator uses, see
// each model's price, and a projected cost to cover every remaining match
// through the end of the tournament. The projection updates live as the
// admin tweaks the "generations per match" assumption.

export function AiModelCard({
  currentModelId,
  remainingMatches,
  autogenEnabled,
  autogenLeadHours,
  locale,
}: {
  currentModelId: string;
  remainingMatches: number;
  autogenEnabled: boolean;
  autogenLeadHours: number;
  locale: Locale;
}) {
  const router = useRouter();
  const isHebrew = locale === "he";
  const { pending, run } = usePendingAction();
  const [selected, setSelected] = useState(currentModelId);
  const [gens, setGens] = useState(DEFAULT_GENS_PER_MATCH);
  const [autoOn, setAutoOn] = useState(autogenEnabled);
  const [leadHours, setLeadHours] = useState(autogenLeadHours);

  const saveAutogen = (enabled: boolean, hours: number) => {
    void run(async () => {
      await setAutogenConfig({ enabled, leadHours: hours });
      router.refresh();
    });
  };

  const pick = (id: string) => {
    if (id === selected || pending) return;
    setSelected(id);
    void run(async () => {
      const res = await setSuggestModel(id);
      if (!res.ok) setSelected(currentModelId); // revert on failure
      router.refresh();
    });
  };

  const usd = (n: number) =>
    n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface inline-flex items-center gap-2">
          <Cpu className="h-5 w-5" strokeWidth={1.75} />
          {isHebrew ? "מודל AI ועלות" : "AI model & cost"}
        </h2>
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? `המודל שמייצר את הצעות הלייב. החיזוי מכסה ${remainingMatches} משחקים שנותרו.`
            : `The model that generates live-bet suggestions. The projection covers ${remainingMatches} remaining matches.`}
        </p>
      </header>

      <label className="flex items-center gap-3 flex-wrap">
        <LabelCaps>{isHebrew ? "ייצורים למשחק" : "Generations / match"}</LabelCaps>
        <input
          type="number"
          min={1}
          max={20}
          value={gens}
          onChange={(e) => {
            const n = parseInt(e.target.value || "1", 10);
            setGens(Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : 1);
          }}
          className="h-11 w-20 px-3 rounded border border-outline bg-surface-container-lowest text-base font-bold tabular-nums text-center focus:outline-none focus:border-primary"
          dir="ltr"
        />
        <span className="text-xs text-on-surface-variant">
          {isHebrew ? "כמה פעמים בממוצע תרענן הצעות לכל משחק" : "avg. times you regenerate per match"}
        </span>
      </label>

      <ul className="flex flex-col gap-2">
        {SUGGEST_MODELS.map((m) => {
          const total = projectCost({ model: m, remainingMatches, gensPerMatch: gens });
          const active = selected === m.id;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => pick(m.id)}
                disabled={pending}
                className={clsx(
                  "press-down w-full text-start rounded-xl border p-3 flex flex-col gap-1.5 transition-colors",
                  active
                    ? "border-2 border-primary bg-primary-container/40"
                    : "border-outline-variant bg-surface-container-lowest hover:bg-surface-container",
                  pending && "opacity-70",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-bold text-on-surface">
                    {active && <Check className="h-4 w-4 text-primary shrink-0" strokeWidth={2.5} />}
                    {m.label}
                    {m.recommended && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-primary border border-primary/40 rounded-full px-1.5 py-0.5">
                        {isHebrew ? "מומלץ" : "Rec"}
                      </span>
                    )}
                  </span>
                  <span className="text-end shrink-0">
                    <bdi className="tabular-nums font-bold text-on-surface">~{usd(total)}</bdi>
                    <span className="block text-[10px] text-on-surface-variant">
                      {isHebrew ? "עד סוף המונדיאל" : "to tournament end"}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant">
                  {isHebrew ? m.blurbHe : m.blurbEn}
                </p>
                <p className="text-[11px] text-on-surface-variant tabular-nums" dir="ltr">
                  ${m.inputPricePerM}/M in · ${m.outputPricePerM}/M out · {usd(costPerCall(m))}/gen
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoOn}
            disabled={pending}
            onChange={(e) => {
              setAutoOn(e.target.checked);
              saveAutogen(e.target.checked, leadHours);
            }}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-bold text-on-surface text-sm">
              {isHebrew ? "ייצור אוטומטי יומי" : "Auto-generate daily"}
            </span>
            <span className="text-xs text-on-surface-variant">
              {isHebrew
                ? "כל יום, צור טיוטות AI למשחקים הקרובים שאין להם הימורים. אתה עדיין מאשר ידנית."
                : "Each day, seed AI drafts for upcoming matches with no bets. You still approve manually."}
            </span>
          </span>
        </label>
        {autoOn && (
          <label className="flex items-center gap-3 flex-wrap ps-8">
            <LabelCaps>{isHebrew ? "שעות לפני פתיחה" : "Lead hours"}</LabelCaps>
            <input
              type="number"
              min={1}
              max={72}
              value={leadHours}
              disabled={pending}
              onChange={(e) => {
                const n = parseInt(e.target.value || "1", 10);
                const clamped = Number.isFinite(n) ? Math.max(1, Math.min(72, n)) : 1;
                setLeadHours(clamped);
              }}
              onBlur={() => saveAutogen(autoOn, leadHours)}
              className="h-11 w-20 px-3 rounded border border-outline bg-surface-container-lowest text-base font-bold tabular-nums text-center focus:outline-none focus:border-primary"
              dir="ltr"
            />
            <span className="text-xs text-on-surface-variant">
              {isHebrew ? "כמה זמן לפני המשחק לזרוע" : "how early before kickoff to seed"}
            </span>
          </label>
        )}
      </div>

      <p className="text-[11px] text-tertiary-fixed-dim">
        {isHebrew
          ? "מבוסס על ~2.5k טוקני קלט ו-4k פלט לייצור. מחירים מ-models.dev (יוני 2026)."
          : "Based on ~2.5k input + 4k output tokens per generation. Prices from models.dev (Jun 2026)."}
      </p>
    </Card>
  );
}
