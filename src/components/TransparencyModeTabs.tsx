import Link from "next/link";
import { clsx } from "clsx";
import { ListChecks, History } from "lucide-react";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";
import type { TransparencyCategory } from "@/db/queries";

// Top-level switch on /transparency between the two ways to read the same
// lock-safe data: "By question" (the original per-question feed, grouped
// into category tabs) and "Player history" (one player's complete,
// all-surfaces timeline + head-to-head). Link-based, no client state, so
// it matches TransparencyTabs / BetsTabs. The player-history pill is only
// rendered when the admin kill-switch leaves the mode enabled.
export function TransparencyModeTabs({
  locale,
  active,
  userId,
  tab,
  showPlayerHistory,
  labels,
}: {
  locale: Locale;
  active: "questions" | "player";
  userId?: string;
  tab?: TransparencyCategory;
  showPlayerHistory: boolean;
  labels: { byQuestion: string; playerHistory: string };
}) {
  const base = localePath(locale, "transparency");

  const questionParams = new URLSearchParams();
  if (tab) questionParams.set("tab", tab);
  if (userId) questionParams.set("user", userId);
  const questionHref = questionParams.toString()
    ? `${base}?${questionParams.toString()}`
    : base;

  const playerParams = new URLSearchParams();
  playerParams.set("view", "player");
  if (userId) playerParams.set("user", userId);
  const playerHref = `${base}?${playerParams.toString()}`;

  return (
    <div className="flex gap-2 p-1 rounded-full bg-surface-container-low border border-outline-variant self-start max-w-full">
      <Pill href={questionHref} active={active === "questions"} icon={ListChecks}>
        {labels.byQuestion}
      </Pill>
      {showPlayerHistory && (
        <Pill href={playerHref} active={active === "player"} icon={History}>
          {labels.playerHistory}
        </Pill>
      )}
    </div>
  );
}

function Pill({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: typeof ListChecks;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "press-down inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-full text-sm font-bold whitespace-nowrap",
        active
          ? "bg-primary text-on-primary"
          : "text-on-surface hover:bg-surface-container",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
      {children}
    </Link>
  );
}
