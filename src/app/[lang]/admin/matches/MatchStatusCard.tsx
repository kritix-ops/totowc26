"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Ban,
  CalendarClock,
  Check,
  RotateCcw,
  Scale,
  Trophy,
} from "lucide-react";
import { Card, Chip, LabelCaps, PillButton } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import type { Locale } from "../../dictionaries";
import type { CancelResolutionConfig } from "@/lib/matches/cancel";
import {
  cancelMatch,
  postponeMatch,
  reopenMatch,
  rescheduleMatch,
  resolveCanceledMatch,
} from "./actions";

export type AdminMatchRow = {
  id: string;
  homeName: string;
  awayName: string;
  kickoffIso: string;
  kickoffLabel: string;
  stage: string;
  status: "scheduled" | "live" | "postponed" | "canceled";
  cancelResolution: "void" | "awarded" | "split" | null;
  cancelResolutionConfig: CancelResolutionConfig;
  guessCount: number;
  liveBetCount: number;
};

type Mode = null | "postpone" | "cancel" | "reschedule" | "resolve" | "reopen";
type ResolutionKind = "void" | "awarded" | "split";

// One match row with contextual status actions. The control set depends on
// status: a live/scheduled match can be postponed or canceled; a postponed
// match can be rescheduled, canceled, or reopened; a canceled match awaits a
// resolution (or shows its settled summary). Every mutating action requires a
// reason that lands in the immutable match_status_audit trail.
export function MatchStatusCard({
  locale,
  match,
  splitDefaultPoints,
}: {
  locale: Locale;
  match: AdminMatchRow;
  splitDefaultPoints: number;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const { pending, run } = usePendingAction();

  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // reschedule input (datetime-local, browser-local wall clock)
  const [kickoffLocal, setKickoffLocal] = useState(() =>
    isoToLocalInput(match.kickoffIso),
  );
  // resolve inputs
  const [resKind, setResKind] = useState<ResolutionKind>("void");
  const [awardHome, setAwardHome] = useState("");
  const [awardAway, setAwardAway] = useState("");
  const [splitPoints, setSplitPoints] = useState(String(splitDefaultPoints));

  const resetPanel = () => {
    setMode(null);
    setReason("");
    setError(null);
    setSuccess(null);
  };

  const openMode = (m: Mode) => {
    setMode(m);
    setReason("");
    setError(null);
    setSuccess(null);
  };

  const fail = (msg: string) => setError(msg);

  const finish = (msg: string) => {
    setSuccess(msg);
    setMode(null);
    setReason("");
    router.refresh();
  };

  const guardReason = (): string | null => {
    const r = reason.trim();
    if (r.length < 3) {
      fail(isHebrew ? "סיבה חייבת לפחות 3 תווים" : "Reason must be 3+ characters");
      return null;
    }
    return r;
  };

  const onPostpone = () => {
    const r = guardReason();
    if (!r) return;
    setError(null);
    void run(async () => {
      const res = await postponeMatch(match.id, r);
      if (!res.ok) return fail(translate(res.error, isHebrew));
      finish(isHebrew ? "המשחק סומן כנדחה." : "Match marked postponed.");
    });
  };

  const onReschedule = () => {
    const r = guardReason();
    if (!r) return;
    const iso = localInputToIso(kickoffLocal);
    if (!iso) {
      return fail(isHebrew ? "מועד לא תקין" : "Invalid date/time");
    }
    setError(null);
    void run(async () => {
      const res = await rescheduleMatch(match.id, iso, r);
      if (!res.ok) return fail(translate(res.error, isHebrew));
      finish(isHebrew ? "נקבע מועד חדש. ההימורים נפתחו מחדש." : "Rescheduled. Betting reopened.");
    });
  };

  const onCancel = () => {
    const r = guardReason();
    if (!r) return;
    if (
      !window.confirm(
        isHebrew
          ? "לבטל את המשחק? כל הלייבים על המשחק יבוטלו ויוחזרו מיד. ניחושי התוצאה ימתינו להחלטה שלך ולא יקבלו ניקוד עד אז."
          : "Cancel this match? All its live bets are voided and refunded now. The 1/X/2 guesses wait for your resolution and earn nothing until then.",
      )
    ) {
      return;
    }
    setError(null);
    void run(async () => {
      const res = await cancelMatch(match.id, r);
      if (!res.ok) return fail(translate(res.error, isHebrew));
      finish(
        isHebrew
          ? `המשחק בוטל. ${res.liveBetsVoided} לייבים בוטלו והוחזרו. כעת בחר איך לסגור את ניחושי התוצאה.`
          : `Match canceled. ${res.liveBetsVoided} live bets voided & refunded. Now choose how the guesses settle.`,
      );
    });
  };

  const onResolve = () => {
    const r = guardReason();
    if (!r) return;

    let config: CancelResolutionConfig = null;
    if (resKind === "awarded") {
      const h = Number(awardHome);
      const a = Number(awardAway);
      if (!isScore(h) || !isScore(a)) {
        return fail(isHebrew ? "תוצאה טכנית לא תקינה" : "Invalid technical score");
      }
      config = { kind: "awarded", home: h, away: a };
    } else if (resKind === "split") {
      const p = Number(splitPoints);
      if (!Number.isInteger(p) || p < 0 || p > 1000) {
        return fail(isHebrew ? "כמות נקודות לא תקינה" : "Invalid points amount");
      }
      config = { kind: "split", points: p };
    }

    if (
      !window.confirm(
        isHebrew
          ? "לסגור את ניחושי התוצאה לפי הבחירה הזו? הניקוד יחושב מיד."
          : "Settle the guesses with this choice? Scoring runs immediately.",
      )
    ) {
      return;
    }
    setError(null);
    void run(async () => {
      const res = await resolveCanceledMatch(match.id, resKind, config, r);
      if (!res.ok) return fail(translate(res.error, isHebrew));
      finish(
        isHebrew
          ? `נסגר. ${res.scored} ניחושים קיבלו ניקוד.`
          : `Settled. ${res.scored} guesses scored.`,
      );
    });
  };

  const onReopen = () => {
    const r = guardReason();
    if (!r) return;
    if (
      !window.confirm(
        isHebrew
          ? "להחזיר את המשחק לתזמון רגיל? שים לב: לייבים שבוטלו בעת הביטול לא משוחזרים אוטומטית."
          : "Return the match to scheduled? Note: live bets voided on cancel are not auto-restored.",
      )
    ) {
      return;
    }
    setError(null);
    void run(async () => {
      const res = await reopenMatch(match.id, r);
      if (!res.ok) return fail(translate(res.error, isHebrew));
      finish(isHebrew ? "המשחק הוחזר לתזמון." : "Match returned to scheduled.");
    });
  };

  const isResolved = match.status === "canceled" && match.cancelResolution !== null;

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      {/* Match line */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-bold text-base text-on-surface truncate">
            {match.homeName} <span className="text-on-surface-variant">×</span>{" "}
            {match.awayName}
          </span>
          <span className="text-xs text-on-surface-variant">
            {match.kickoffLabel} · {stageLabel(match.stage, isHebrew)}
          </span>
          <span className="text-xs text-on-surface-variant">
            {isHebrew
              ? `${match.guessCount} ניחושים · ${match.liveBetCount} לייבים`
              : `${match.guessCount} guesses · ${match.liveBetCount} live bets`}
          </span>
        </div>
        <StatusBadge
          status={match.status}
          resolution={match.cancelResolution}
          isHebrew={isHebrew}
        />
      </div>

      {/* Resolved summary */}
      {isResolved && (
        <p className="text-sm text-on-surface-variant inline-flex items-center gap-2">
          <Check className="h-4 w-4 text-secondary" strokeWidth={2.5} />
          {resolutionSummary(
            match.cancelResolution,
            match.cancelResolutionConfig,
            isHebrew,
          )}
        </p>
      )}

      {/* Action buttons (hidden while a panel is open or once resolved) */}
      {!mode && !isResolved && (
        <div className="flex flex-wrap gap-2">
          {(match.status === "scheduled" || match.status === "live") && (
            <>
              <ActionBtn onClick={() => openMode("postpone")} icon={<CalendarClock className="h-4 w-4" strokeWidth={2} />}>
                {isHebrew ? "דחה" : "Postpone"}
              </ActionBtn>
              <ActionBtn tone="danger" onClick={() => openMode("cancel")} icon={<Ban className="h-4 w-4" strokeWidth={2} />}>
                {isHebrew ? "בטל" : "Cancel"}
              </ActionBtn>
            </>
          )}
          {match.status === "postponed" && (
            <>
              <ActionBtn onClick={() => openMode("reschedule")} icon={<CalendarClock className="h-4 w-4" strokeWidth={2} />}>
                {isHebrew ? "קבע מועד חדש" : "Reschedule"}
              </ActionBtn>
              <ActionBtn tone="danger" onClick={() => openMode("cancel")} icon={<Ban className="h-4 w-4" strokeWidth={2} />}>
                {isHebrew ? "בטל" : "Cancel"}
              </ActionBtn>
              <ActionBtn onClick={() => openMode("reopen")} icon={<RotateCcw className="h-4 w-4" strokeWidth={2} />}>
                {isHebrew ? "החזר לתזמון" : "Reopen"}
              </ActionBtn>
            </>
          )}
          {match.status === "canceled" && match.cancelResolution === null && (
            <>
              <ActionBtn onClick={() => openMode("resolve")} icon={<Scale className="h-4 w-4" strokeWidth={2} />}>
                {isHebrew ? "בחר סגירה" : "Resolve"}
              </ActionBtn>
              <ActionBtn onClick={() => openMode("reopen")} icon={<RotateCcw className="h-4 w-4" strokeWidth={2} />}>
                {isHebrew ? "החזר לתזמון" : "Reopen"}
              </ActionBtn>
            </>
          )}
        </div>
      )}

      {/* Active panel */}
      {mode && (
        <div className="flex flex-col gap-3 pt-1">
          {mode === "reschedule" && (
            <div className="flex flex-col gap-1.5">
              <LabelCaps>{isHebrew ? "מועד חדש" : "New kickoff"}</LabelCaps>
              <input
                type="datetime-local"
                value={kickoffLocal}
                onChange={(e) => setKickoffLocal(e.target.value)}
                className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
              />
            </div>
          )}

          {mode === "resolve" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <LabelCaps>{isHebrew ? "איך לסגור" : "Settlement"}</LabelCaps>
                <div className="flex flex-wrap gap-2">
                  <SegBtn active={resKind === "void"} onClick={() => setResKind("void")} icon={<Ban className="h-4 w-4" strokeWidth={2} />}>
                    {isHebrew ? "ביטול והחזר" : "Void & refund"}
                  </SegBtn>
                  <SegBtn active={resKind === "awarded"} onClick={() => setResKind("awarded")} icon={<Trophy className="h-4 w-4" strokeWidth={2} />}>
                    {isHebrew ? "תוצאה טכנית" : "Technical result"}
                  </SegBtn>
                  <SegBtn active={resKind === "split"} onClick={() => setResKind("split")} icon={<Scale className="h-4 w-4" strokeWidth={2} />}>
                    {isHebrew ? "חלוקת נקודות" : "Split points"}
                  </SegBtn>
                </div>
              </div>

              {resKind === "void" && (
                <p className="text-xs text-on-surface-variant">
                  {isHebrew
                    ? "כולם מקבלים 0 על הניחוש, בלי קנס. ניטרלי לחלוטין."
                    : "Everyone gets 0 for the guess, no penalty. Fully neutral."}
                </p>
              )}

              {resKind === "awarded" && (
                <div className="flex items-end gap-3">
                  <div className="flex flex-col gap-1.5">
                    <LabelCaps>{match.homeName}</LabelCaps>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={99}
                      value={awardHome}
                      onChange={(e) => setAwardHome(e.target.value)}
                      className="w-20 min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base text-center"
                    />
                  </div>
                  <span className="pb-3 text-on-surface-variant">:</span>
                  <div className="flex flex-col gap-1.5">
                    <LabelCaps>{match.awayName}</LabelCaps>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={99}
                      value={awardAway}
                      onChange={(e) => setAwardAway(e.target.value)}
                      className="w-20 min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base text-center"
                    />
                  </div>
                </div>
              )}

              {resKind === "split" && (
                <div className="flex flex-col gap-1.5">
                  <LabelCaps>{isHebrew ? "נקודות לכל מנחש" : "Points per guesser"}</LabelCaps>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={1000}
                    value={splitPoints}
                    onChange={(e) => setSplitPoints(e.target.value)}
                    className="w-28 min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base text-center"
                  />
                </div>
              )}
            </div>
          )}

          {/* Shared reason */}
          <div className="flex flex-col gap-1.5">
            <LabelCaps>{isHebrew ? "סיבה" : "Reason"}</LabelCaps>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isHebrew ? "למשל: סופת ברקים, המשחק נדחה" : "e.g. lightning storm, match called off"
              }
              dir={isHebrew ? "rtl" : "ltr"}
              maxLength={500}
              className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
            />
            <p className="text-xs text-on-surface-variant">
              {isHebrew
                ? "נשמר באודיט פנימי בלתי-משתנה. אל תכתוב מידע אישי."
                : "Saved in the immutable internal audit log. Do not enter personal info."}
            </p>
          </div>

          {error && (
            <p className="inline-flex items-center gap-2 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse md:flex-row md:justify-end gap-2">
            <PillButton type="button" variant="ghost" disabled={pending} onClick={resetPanel} className="min-h-[48px]">
              {isHebrew ? "ביטול" : "Cancel"}
            </PillButton>
            <PillButton
              type="button"
              variant={mode === "cancel" ? "ghost" : "primary"}
              disabled={pending || reason.trim().length < 3}
              onClick={confirmHandlers(mode, {
                onPostpone,
                onReschedule,
                onCancel,
                onResolve,
                onReopen,
              })}
              className={
                mode === "cancel"
                  ? "min-h-[48px] !border-error/50 !text-error hover:!bg-error/10"
                  : "min-h-[48px]"
              }
            >
              {pending
                ? isHebrew
                  ? "מבצע…"
                  : "Working…"
                : confirmLabel(mode, isHebrew)}
            </PillButton>
          </div>
        </div>
      )}

      {success && !mode && (
        <p className="inline-flex items-center gap-2 text-sm text-secondary">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          {success}
        </p>
      )}
    </Card>
  );
}

// ---- small presentational helpers ----

function ActionBtn({
  children,
  icon,
  onClick,
  tone = "default",
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "press-down inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full border text-sm font-bold transition-colors " +
        (tone === "danger"
          ? "border-error/50 text-error hover:bg-error/10"
          : "border-outline text-on-surface hover:bg-surface-container")
      }
    >
      {icon}
      {children}
    </button>
  );
}

function SegBtn({
  children,
  icon,
  active,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "press-down inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full border text-sm font-bold transition-colors " +
        (active
          ? "border-primary bg-primary-fixed text-on-primary-fixed-variant"
          : "border-outline text-on-surface hover:bg-surface-container")
      }
    >
      {icon}
      {children}
    </button>
  );
}

function StatusBadge({
  status,
  resolution,
  isHebrew,
}: {
  status: AdminMatchRow["status"];
  resolution: AdminMatchRow["cancelResolution"];
  isHebrew: boolean;
}) {
  if (status === "scheduled") {
    return <Chip tone="primary">{isHebrew ? "מתוכנן" : "Scheduled"}</Chip>;
  }
  if (status === "live") {
    return <Chip tone="secondary">{isHebrew ? "חי" : "Live"}</Chip>;
  }
  if (status === "postponed") {
    return <Chip tone="warning">{isHebrew ? "נדחה" : "Postponed"}</Chip>;
  }
  // canceled
  return (
    <Chip tone="warning">
      {resolution === null
        ? isHebrew
          ? "בוטל · ממתין"
          : "Canceled · pending"
        : isHebrew
          ? "בוטל · נסגר"
          : "Canceled · settled"}
    </Chip>
  );
}

function confirmHandlers(
  mode: Mode,
  h: {
    onPostpone: () => void;
    onReschedule: () => void;
    onCancel: () => void;
    onResolve: () => void;
    onReopen: () => void;
  },
): () => void {
  switch (mode) {
    case "postpone":
      return h.onPostpone;
    case "reschedule":
      return h.onReschedule;
    case "cancel":
      return h.onCancel;
    case "resolve":
      return h.onResolve;
    case "reopen":
      return h.onReopen;
    default:
      return () => {};
  }
}

function confirmLabel(mode: Mode, isHebrew: boolean): string {
  switch (mode) {
    case "postpone":
      return isHebrew ? "אשר דחייה" : "Confirm postpone";
    case "reschedule":
      return isHebrew ? "שמור מועד" : "Save kickoff";
    case "cancel":
      return isHebrew ? "אשר ביטול" : "Confirm cancel";
    case "resolve":
      return isHebrew ? "סגור ניחושים" : "Settle guesses";
    case "reopen":
      return isHebrew ? "החזר לתזמון" : "Reopen";
    default:
      return isHebrew ? "אשר" : "Confirm";
  }
}

function resolutionSummary(
  resolution: AdminMatchRow["cancelResolution"],
  config: CancelResolutionConfig,
  isHebrew: boolean,
): string {
  if (resolution === "void") {
    return isHebrew ? "נסגר בביטול והחזר (0 נקודות לכולם)." : "Settled by void & refund (0 to all).";
  }
  if (resolution === "split" && config && config.kind === "split") {
    return isHebrew
      ? `נסגר בחלוקה: ${config.points} נקודות לכל מנחש.`
      : `Settled by split: ${config.points} points each.`;
  }
  if (resolution === "awarded" && config && config.kind === "awarded") {
    return isHebrew
      ? `נסגר בתוצאה טכנית ${config.home}–${config.away}.`
      : `Settled by technical result ${config.home}–${config.away}.`;
  }
  return isHebrew ? "נסגר." : "Settled.";
}

function stageLabel(stage: string, isHebrew: boolean): string {
  const he: Record<string, string> = {
    group: "בתים",
    r32: "1/16",
    r16: "1/8",
    qf: "רבע גמר",
    sf: "חצי גמר",
    third_place: "מקום 3",
    final: "גמר",
  };
  return isHebrew ? (he[stage] ?? stage) : stage;
}

// ---- pure helpers ----

function isScore(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 99;
}

// ISO (UTC) -> value for a datetime-local input, in the browser's local zone.
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

// datetime-local value (browser-local) -> ISO (UTC) for the server.
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  forbidden: ["אין הרשאה", "Not allowed"],
  match_not_found: ["המשחק לא נמצא", "Match not found"],
  invalid_status: ["הפעולה לא אפשרית במצב הנוכחי", "Action not allowed in the current state"],
  invalid_reason: ["סיבה חייבת לפחות 3 תווים", "Reason must be 3+ characters"],
  invalid_resolution: ["בחירת סגירה לא תקינה", "Invalid settlement choice"],
  invalid_awarded_score: ["תוצאה טכנית לא תקינה", "Invalid technical score"],
  invalid_split_points: ["כמות נקודות לא תקינה", "Invalid points amount"],
  invalid_kickoff: ["מועד לא תקין", "Invalid date/time"],
  already_resolved: ["המשחק כבר נסגר", "Match already settled"],
} as const satisfies Record<string, LocalizedTuple>;

function translate(err: string, isHebrew: boolean): string {
  return translateAdminError(err, ERROR_MAP, isHebrew);
}
