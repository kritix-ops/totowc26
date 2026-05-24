"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trophy, Medal, Award, X, AlertCircle, Check } from "lucide-react";
import { clsx } from "clsx";
import type { Dictionary, Locale } from "../dictionaries";
import { Card, Chip, LabelCaps, PillButton, SectionHeading } from "@/components/ui";
import { Flag } from "@/components/Flag";
import type { BracketRow, BracketSlot, TeamRow } from "@/db/queries";
import { setBracketPick } from "./actions";

const SLOTS: Array<{
  key: BracketSlot;
  Icon: typeof Trophy;
  color: string;
  payoutKey: "payoutChampion" | "payoutRunnerUp" | "payoutThird" | "payoutFourth";
}> = [
  { key: "champion", Icon: Trophy, color: "text-tertiary-fixed-dim", payoutKey: "payoutChampion" },
  { key: "runner_up", Icon: Medal, color: "text-outline", payoutKey: "payoutRunnerUp" },
  { key: "third", Icon: Award, color: "text-tertiary", payoutKey: "payoutThird" },
  { key: "fourth", Icon: Award, color: "text-outline-variant", payoutKey: "payoutFourth" },
];

const SLOT_LABEL_KEYS: Record<BracketSlot, "champion" | "runnerUp" | "third" | "fourth"> = {
  champion: "champion",
  runner_up: "runnerUp",
  third: "third",
  fourth: "fourth",
};

export function BracketEditor({
  picks,
  teams,
  locale,
  dict,
}: {
  picks: Record<BracketSlot, BracketRow>;
  teams: TeamRow[];
  locale: Locale;
  dict: Dictionary;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [openSlot, setOpenSlot] = useState<BracketSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(picks);

  const pickedCodes = new Set(
    Object.values(local)
      .map((p) => p.teamCode)
      .filter((c): c is string => c !== null),
  );

  const update = (slot: BracketSlot, team: TeamRow | null) => {
    setError(null);
    startTransition(async () => {
      const res = await setBracketPick(slot, team?.code ?? null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLocal((prev) => ({
        ...prev,
        [slot]: {
          slot,
          teamCode: team?.code ?? null,
          teamNameHe: team?.nameHe ?? null,
          teamNameEn: team?.nameEn ?? null,
          teamFlag: team?.flag ?? null,
        },
      }));
      setOpenSlot(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {SLOTS.map(({ key, Icon, color, payoutKey }) => {
          const pick = local[key];
          const labelKey = SLOT_LABEL_KEYS[key];
          return (
            <Card key={key} className="p-5 md:p-6 flex flex-col items-center gap-3 text-center">
              <Icon className={`h-8 w-8 ${color}`} strokeWidth={1.5} />
              <SectionHeading underline="thin" as="h3">
                {dict.bracket[labelKey]}
              </SectionHeading>
              {pick.teamCode ? (
                <div className="flex flex-col items-center gap-2 w-full">
                  <Flag code={pick.teamCode} size={72} rounded="md" />
                  <span className="text-base md:text-lg font-bold">
                    {isHebrew ? pick.teamNameHe : pick.teamNameEn}
                  </span>
                  <button
                    type="button"
                    onClick={() => update(key, null)}
                    disabled={pending}
                    className="text-xs text-on-surface-variant hover:text-error inline-flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />
                    {isHebrew ? "הסר בחירה" : "Remove pick"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenSlot(key)}
                  className="press-down w-full min-h-[48px] py-3 border-2 border-dashed border-outline-variant rounded-lg text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
                >
                  {dict.bracket.pickTeam}
                </button>
              )}
              <Chip tone="default">{dict.bracket[payoutKey]}</Chip>
            </Card>
          );
        })}
      </div>

      {error && (
        <p className="inline-flex items-center gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "השמירה נכשלה" : "Save failed"}
        </p>
      )}

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h3">
          {isHebrew ? "לחץ על קבוצה כדי להחליף שיבוץ" : "Tap a team to assign"}
        </SectionHeading>
        <TeamGrid
          teams={teams}
          isHebrew={isHebrew}
          pickedCodes={pickedCodes}
          onPick={(team) => {
            // When clicked directly without an explicit slot, default to the
            // first empty slot, or champion.
            const slot =
              SLOTS.map((s) => s.key).find((s) => !local[s].teamCode) ?? "champion";
            update(slot, team);
          }}
        />
      </Card>

      {openSlot && (
        <SlotPicker
          slot={openSlot}
          dict={dict}
          isHebrew={isHebrew}
          teams={teams}
          pickedCodes={pickedCodes}
          pending={pending}
          onClose={() => setOpenSlot(null)}
          onPick={(team) => update(openSlot, team)}
        />
      )}
    </div>
  );
}

function TeamGrid({
  teams,
  isHebrew,
  pickedCodes,
  onPick,
}: {
  teams: TeamRow[];
  isHebrew: boolean;
  pickedCodes: Set<string>;
  onPick: (team: TeamRow) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 md:gap-3">
      {teams.map((team) => {
        const used = pickedCodes.has(team.code);
        return (
          <button
            key={team.code}
            type="button"
            onClick={() => onPick(team)}
            className={clsx(
              "press-down flex flex-col items-center gap-1 p-2 md:p-3 rounded-lg border bg-surface-container-lowest transition-colors min-h-[80px]",
              used
                ? "border-secondary opacity-70"
                : "border-outline-variant hover:border-primary",
            )}
          >
            <Flag code={team.code} size={36} rounded="sm" />
            <span className="text-[11px] md:text-xs font-bold text-center leading-tight">
              {isHebrew ? team.nameHe : team.nameEn}
            </span>
            {used && <Check className="h-3 w-3 text-secondary" />}
          </button>
        );
      })}
    </div>
  );
}

function SlotPicker({
  slot,
  dict,
  isHebrew,
  teams,
  pickedCodes,
  pending,
  onClose,
  onPick,
}: {
  slot: BracketSlot;
  dict: Dictionary;
  isHebrew: boolean;
  teams: TeamRow[];
  pickedCodes: Set<string>;
  pending: boolean;
  onClose: () => void;
  onPick: (team: TeamRow) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-on-surface/40" />
      <div className="relative bg-surface w-full max-w-2xl max-h-[100dvh] md:max-h-[90dvh] overflow-y-auto md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <header className="sticky top-0 bg-surface border-b border-outline-variant px-5 py-4 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">
            {dict.bracket.pickTeam}: {dict.bracket[SLOT_LABEL_KEYS[slot]]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-surface-container"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="p-5">
          <TeamGrid
            teams={teams}
            isHebrew={isHebrew}
            pickedCodes={pickedCodes}
            onPick={(t) => {
              if (!pending) onPick(t);
            }}
          />
        </div>
        <LabelCaps className="px-5 pb-5 text-on-surface-variant">
          {isHebrew
            ? "קבוצה שכבר משובצת מוצגת בצבע ירוק עם סימן הוק"
            : "Already-assigned teams show in green with a check"}
        </LabelCaps>
      </div>
    </div>
  );
}
