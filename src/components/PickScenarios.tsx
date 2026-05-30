import { ArrowRight, Coins, CornerDownLeft, X, Check } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";

// "If correct / If wrong" balance preview that sits inside a bet card.
// Same component for every bet type — custom-bets, match scores, duels —
// the caller hands it a stake + a list of outcome scenarios with their
// point delta. The component shows the resulting bank balance per
// scenario so the user never has to do mental math.
//
// Mental model from the user's perspective:
//   "Right now I have X. If I commit this pick, I pay {stake}. If I'm
//    right, I get back {delta}. So my balance ends at X − stake + delta
//    in the win case, or X − stake in the wrong case."
//
// Two passes of rendering:
//   1. Stake row (only when stake > 0) — pulls the cost off the bank.
//   2. Scenario rows — for each outcome, shows the resulting balance.
//
// Tone drives both the icon and the colour cue. Keep tones sparingly
// used: "positive" for any winning outcome, "negative" for net loss
// (penalty markets), "neutral" for break-even (wrong pick on stakeless
// match bets).

export type Scenario = {
  // Short human label. e.g. "פגיעה מדויקת" / "Exact" / "Direction" / "Wrong".
  label: string;
  // Net delta vs the post-stake balance. +15 for exact match. +5 for
  // direction. 0 for wrong on stakeless. -5 for wrong on penalty mode.
  // Per-pick payouts (multi_choice with payoutOverride) translate to
  // delta = payoutOverride (since the stake is already subtracted in
  // the row above and the payout is GROSS).
  delta: number;
  tone: "positive" | "neutral" | "negative";
};

export function PickScenarios({
  locale,
  currentBalance,
  stake,
  scenarios,
  className,
}: {
  locale: Locale;
  currentBalance: number;
  stake: number;
  scenarios: Scenario[];
  className?: string;
}) {
  const isHebrew = locale === "he";
  const postStakeBalance = currentBalance - stake;
  const overdrawn = postStakeBalance < 0;

  return (
    <div
      className={clsx(
        "flex flex-col gap-2 p-3 rounded-lg border border-outline-variant bg-surface-container-low",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 pb-1">
        <span className="text-[11px] uppercase tracking-wide text-on-surface-variant font-bold">
          {isHebrew ? "תרחישים" : "Scenarios"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
          <Coins className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          <span className="tabular-nums">
            {isHebrew ? "כעת" : "Now"} {currentBalance}
          </span>
        </span>
      </div>

      {stake > 0 && (
        <ScenarioRow
          icon={<CornerDownLeft className="h-3.5 w-3.5" strokeWidth={2} />}
          label={isHebrew ? "עלות הימור" : "Stake"}
          delta={-stake}
          result={postStakeBalance}
          tone="negative"
          isHebrew={isHebrew}
          subdued
          overdrawn={overdrawn}
        />
      )}

      {scenarios.map((s, i) => {
        const result = postStakeBalance + s.delta;
        return (
          <ScenarioRow
            key={`${s.label}-${i}`}
            icon={iconForTone(s.tone)}
            label={s.label}
            delta={s.delta}
            result={result}
            tone={s.tone}
            isHebrew={isHebrew}
          />
        );
      })}
    </div>
  );
}

function ScenarioRow({
  icon,
  label,
  delta,
  result,
  tone,
  isHebrew,
  subdued,
  overdrawn,
}: {
  icon: React.ReactNode;
  label: string;
  delta: number;
  result: number;
  tone: "positive" | "neutral" | "negative";
  isHebrew: boolean;
  subdued?: boolean;
  overdrawn?: boolean;
}) {
  const toneCls = {
    positive: "text-success",
    neutral: "text-on-surface-variant",
    negative: "text-error",
  }[tone];
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-2 text-sm tabular-nums",
        subdued && "opacity-80",
      )}
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        <span className={clsx("inline-flex shrink-0", toneCls)} aria-hidden>
          {icon}
        </span>
        <span className="truncate font-medium">{label}</span>
      </span>
      <span className="inline-flex items-center gap-2 shrink-0">
        <span
          className={clsx(
            "text-xs font-bold",
            delta > 0 && "text-success",
            delta < 0 && "text-error",
            delta === 0 && "text-on-surface-variant",
          )}
        >
          {formatDelta(delta)}
        </span>
        <ArrowRight
          className={clsx(
            "h-3 w-3 text-outline shrink-0",
            isHebrew && "rotate-180",
          )}
          strokeWidth={2}
          aria-hidden
        />
        <bdi
          className={clsx(
            "font-bold w-10 text-end",
            overdrawn && "text-error",
          )}
        >
          {result}
        </bdi>
      </span>
    </div>
  );
}

function iconForTone(tone: Scenario["tone"]): React.ReactNode {
  if (tone === "positive") return <Check className="h-3.5 w-3.5" strokeWidth={2.5} />;
  if (tone === "negative") return <X className="h-3.5 w-3.5" strokeWidth={2.5} />;
  return <CornerDownLeft className="h-3.5 w-3.5" strokeWidth={2} />;
}

function formatDelta(d: number): string {
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return "0";
}
