"use client";

import {
  useState,
  useRef,
  useEffect,
  useTransition,
  useId,
} from "react";
import { clsx } from "clsx";
import {
  Pencil,
  X as XIcon,
  AlertCircle,
  AlertTriangle,
  Check,
  Trash2,
} from "lucide-react";
import type { Locale } from "../../../../dictionaries";
import {
  adminClearCustomBetPick,
  adminClearMatchPick,
  adminSetCustomBetPick,
  adminSetMatchPick,
  type AdminWriteResult,
} from "./actions";
import type { MultiChoiceConfig, PickAnswer } from "@/lib/bets/types";

// The four write entrypoints this dialog drives. Injected so the same UI
// serves two callers: the per-user admin proxy edit (default) and the admin
// self-backdate page (which passes its own self-only, audited actions). Both
// action sets return the identical AdminWriteResult shape.
export type AdminPickActions = {
  setCustom: (args: {
    targetUserId: string;
    customBetId: string;
    answer: PickAnswer;
    reason: string;
    lockBypassed: boolean;
    // Player-chosen stake for live (match/day) bets. Omitted on free-pick
    // scopes and when the dialog renders no stake picker — then the server
    // keeps the bet's default stake.
    requestedStake?: number;
  }) => Promise<AdminWriteResult>;
  clearCustom: (args: {
    targetUserId: string;
    customBetId: string;
    reason: string;
    lockBypassed: boolean;
  }) => Promise<AdminWriteResult>;
  setMatch: (args: {
    targetUserId: string;
    matchId: string;
    homeScore: number;
    awayScore: number;
    reason: string;
    lockBypassed: boolean;
  }) => Promise<AdminWriteResult>;
  clearMatch: (args: {
    targetUserId: string;
    matchId: string;
    reason: string;
    lockBypassed: boolean;
  }) => Promise<AdminWriteResult>;
  // "Who advances?" (מי עולה) knockout pick. Optional: only the backdate
  // screen renders the "advance" surface, so the per-user proxy actions omit
  // these. The advance branch guards on their presence.
  setAdvance?: (args: {
    targetUserId: string;
    matchId: string;
    team: string;
    reason: string;
    lockBypassed: boolean;
  }) => Promise<AdminWriteResult>;
  clearAdvance?: (args: {
    targetUserId: string;
    matchId: string;
    reason: string;
    lockBypassed: boolean;
  }) => Promise<AdminWriteResult>;
};

const DEFAULT_ADMIN_PICK_ACTIONS: AdminPickActions = {
  setCustom: adminSetCustomBetPick,
  clearCustom: adminClearCustomBetPick,
  setMatch: adminSetMatchPick,
  clearMatch: adminClearMatchPick,
};
import { SearchableChoicePicker } from "@/components/SearchableChoicePicker";
import { usePickerOptions } from "@/lib/picker-options/client";

// AdminPickEditor: a small dialog that lets an admin set or clear a
// target user's pick on one specific bet. Surfaces are three:
//   - "custom"  — a custom_bets row with an answer_type/config-driven
//                 input (yes_no / number / multi_choice / free_text)
//   - "match"   — a 1/X/2 score pick (two number inputs)
//   - "advance" — a knockout "who advances?" pick (home team / away team)
// In every case the dialog requires a non-empty reason and, when the
// bet's lock has already passed, an explicit "bypass lock" checkbox.

type CustomKind = {
  surface: "custom";
  customBetId: string;
  questionHe: string;
  questionEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  currentAnswer: PickAnswer | null;
  stake: number;
  payout: number;
  // Scope + live-stake bounds + the existing pick's stake. When the scope is
  // live (match/day) and the bounds are present, the dialog shows a "how much
  // to risk" pill row seeded from currentStake (or the bet's default). Absent
  // on the proxy edit path, so that dialog is unchanged. Free-pick scopes
  // (tournament/stage/group) never stake points, so no picker is shown.
  scope?: "match" | "day" | "stage" | "group" | "tournament";
  stakeBounds?: { minStake: number; maxStake: number };
  currentStake?: number | null;
};

type MatchKind = {
  surface: "match";
  matchId: string;
  matchupHe: string;
  matchupEn: string;
  currentHomeScore: number | null;
  currentAwayScore: number | null;
};

type AdvanceKind = {
  surface: "advance";
  matchId: string;
  matchupHe: string;
  matchupEn: string;
  // The two teams in the fixture — the only valid picks. Codes are what the
  // server stores; names are shown on the buttons.
  homeCode: string;
  awayCode: string;
  homeTeamHe: string;
  homeTeamEn: string;
  awayTeamHe: string;
  awayTeamEn: string;
  currentTeam: string | null;
};

type Props = (CustomKind | MatchKind | AdvanceKind) & {
  targetUserId: string;
  targetUserName: string;
  locale: Locale;
  lockAt?: string;
  // Fired after a successful save or clear, before the dialog closes. Lets a
  // host (e.g. the bets-overview drawer) refetch so its read view reflects the
  // edit. Optional — the per-user page relies on revalidatePath instead.
  onSaved?: () => void;
  // Override the write actions (default: the per-user admin proxy actions).
  // The self-backdate page injects its own self-only, audited set.
  actions?: AdminPickActions;
  // Override the trigger button label / aria (default: "Edit"). The
  // self-backdate page uses "Add / fix" wording.
  triggerLabel?: string;
};

const ERROR_HE: Record<string, string> = {
  unauthorized: "צריך להתחבר מחדש",
  forbidden: "אין הרשאת אדמין",
  missing_reason: "חובה לכתוב סיבה",
  self_target: "אדמין לא יכול לערוך את הניחוש של עצמו דרך כאן",
  invalid_input: "ערכים לא תקינים",
  bet_not_found: "ההימור לא נמצא",
  invalid_answer: "תשובה לא תואמת את ההימור",
  not_found: "המשחק לא נמצא",
  invalid: "ערך לא תקין",
  db: "שגיאת מסד נתונים — נסה שוב",
  not_allowed: "אסור",
  closed: "ההימור או המשחק כבר נסגר",
  locked: "ההימור נעול — צריך לסמן 'עקיפת נעילה'",
  already_filled: "אין מה למחוק",
  unaffordable: "אין מספיק נקודות בבנק של המשתמש",
};
const ERROR_EN: Record<string, string> = {
  unauthorized: "Sign in again",
  forbidden: "Admin only",
  missing_reason: "Reason is required",
  self_target: "Admin can't edit their own pick from here",
  invalid_input: "Invalid values",
  bet_not_found: "Bet not found",
  invalid_answer: "Answer doesn't match the bet",
  not_found: "Match not found",
  invalid: "Invalid value",
  db: "Database error — try again",
  not_allowed: "Forbidden",
  closed: "Bet or match is closed",
  locked: "Bet is locked — tick 'bypass lock'",
  already_filled: "Nothing to clear",
  unaffordable: "User's bank is insufficient",
};

export function AdminPickEditor(props: Props) {
  const [open, setOpen] = useState(false);
  const isHebrew = props.locale === "he";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-full border border-outline-variant text-xs font-bold text-on-surface hover:bg-surface-container-low transition-colors"
        aria-label={isHebrew ? "ערוך הימור עבור המשתמש" : "Edit bet for user"}
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        {props.triggerLabel ?? (isHebrew ? "ערוך" : "Edit")}
      </button>
      {open && <Dialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function Dialog(props: Props & { onClose: () => void }) {
  const isHebrew = props.locale === "he";
  const reasonId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [lockBypassed, setLockBypassed] = useState(false);
  const actions = props.actions ?? DEFAULT_ADMIN_PICK_ACTIONS;

  // The current draft selection. Lifted to the dialog so a single bottom
  // "Save" button can read it after the user has filled the reason field
  // and (when needed) ticked the lock-bypass checkbox. Earlier versions
  // fired save on every answer-pill tap, which forced the user to re-tap
  // after typing the reason — and they understandably didn't, so the
  // save silently failed with `missing_reason`. One save button, one
  // submit, no surprises.
  const [customDraft, setCustomDraft] = useState<PickAnswer | null>(
    props.surface === "custom" ? props.currentAnswer : null,
  );
  const [matchHome, setMatchHome] = useState<string>(
    props.surface === "match" && props.currentHomeScore != null
      ? String(props.currentHomeScore)
      : "",
  );
  const [matchAway, setMatchAway] = useState<string>(
    props.surface === "match" && props.currentAwayScore != null
      ? String(props.currentAwayScore)
      : "",
  );
  const [advanceTeam, setAdvanceTeam] = useState<string | null>(
    props.surface === "advance" ? props.currentTeam : null,
  );

  // Live-stake picker state. Only meaningful for a live-scope custom bet with
  // bounds supplied; otherwise the row never renders and the stake stays the
  // bet default. Seeded from the existing pick's stake (or the bet default),
  // clamped into the admin's [min, max] range.
  const showStakePicker =
    props.surface === "custom" &&
    (props.scope === "match" || props.scope === "day") &&
    props.stakeBounds != null;
  const [chosenStake, setChosenStake] = useState<number>(() => {
    if (props.surface !== "custom" || !props.stakeBounds) return 0;
    const seed = props.currentStake ?? props.stake;
    return clampStake(seed, props.stakeBounds.minStake, props.stakeBounds.maxStake);
  });

  // Snapshot the lock state when the dialog opens. The bet's `lockAt` is
  // a fixed instant, so a re-render mid-edit doesn't change whether the
  // checkbox is needed. Computing inside useState keeps Date.now() pure
  // from React's lint perspective.
  const [lockHasPassed] = useState(
    () => props.lockAt != null && new Date(props.lockAt).getTime() <= Date.now(),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const errMap = isHebrew ? ERROR_HE : ERROR_EN;
  function translateResult(result: AdminWriteResult): string | null {
    if (!result.ok) return errMap[result.error] ?? result.error;
    if (result.outcome.status === "filled") return null;
    if (result.outcome.status === "skipped") {
      return errMap[result.outcome.reason] ?? result.outcome.reason;
    }
    return errMap[result.outcome.error] ?? result.outcome.error;
  }

  function handleSaveCustom(answer: PickAnswer) {
    if (props.surface !== "custom") return;
    setError(null);
    console.info("[admin pick editor] save_custom", {
      targetUserId: props.targetUserId,
      customBetId: props.customBetId,
      reasonLen: reason.trim().length,
      lockBypassed,
      lockHasPassed,
    });
    startTransition(async () => {
      const result = await actions.setCustom({
        targetUserId: props.targetUserId,
        customBetId: props.customBetId,
        answer,
        reason,
        lockBypassed,
        requestedStake: showStakePicker ? chosenStake : undefined,
      });
      const msg = translateResult(result);
      if (msg) {
        console.info("[admin pick editor] save_custom_failed", { msg });
        setError(msg);
        return;
      }
      props.onSaved?.();
      props.onClose();
    });
  }

  function handleSaveMatch(home: number, away: number) {
    if (props.surface !== "match") return;
    setError(null);
    console.info("[admin pick editor] save_match", {
      targetUserId: props.targetUserId,
      matchId: props.matchId,
      home,
      away,
      reasonLen: reason.trim().length,
      lockBypassed,
      lockHasPassed,
    });
    startTransition(async () => {
      const result = await actions.setMatch({
        targetUserId: props.targetUserId,
        matchId: props.matchId,
        homeScore: home,
        awayScore: away,
        reason,
        lockBypassed,
      });
      const msg = translateResult(result);
      if (msg) {
        console.info("[admin pick editor] save_match_failed", { msg });
        setError(msg);
        return;
      }
      props.onSaved?.();
      props.onClose();
    });
  }

  function handleSaveAdvance(team: string) {
    if (props.surface !== "advance") return;
    if (!actions.setAdvance) {
      console.error("[admin pick editor] save_advance missing setAdvance action");
      setError(isHebrew ? "פעולה לא זמינה" : "Action unavailable");
      return;
    }
    setError(null);
    console.info("[admin pick editor] save_advance", {
      targetUserId: props.targetUserId,
      matchId: props.matchId,
      team,
      reasonLen: reason.trim().length,
      lockBypassed,
      lockHasPassed,
    });
    startTransition(async () => {
      const result = await actions.setAdvance!({
        targetUserId: props.targetUserId,
        matchId: props.matchId,
        team,
        reason,
        lockBypassed,
      });
      const msg = translateResult(result);
      if (msg) {
        console.info("[admin pick editor] save_advance_failed", { msg });
        setError(msg);
        return;
      }
      props.onSaved?.();
      props.onClose();
    });
  }

  // Validation for the bottom Save button. Mirrors the server gates so
  // a click never fires a request that's destined to fail with a clear
  // client-side cause (empty reason, no draft, lock passed without
  // bypass ticked). Server still re-validates.
  const matchScoreValid = (() => {
    if (props.surface !== "match") return false;
    if (matchHome.trim() === "" || matchAway.trim() === "") return false;
    const h = Number(matchHome);
    const a = Number(matchAway);
    return (
      Number.isFinite(h) && Number.isFinite(a) && h >= 0 && a >= 0 &&
      Number.isInteger(h) && Number.isInteger(a)
    );
  })();
  const customDraftValid = props.surface === "custom" && customDraft != null;
  const advanceDraftValid = props.surface === "advance" && advanceTeam != null;
  const hasDraft =
    props.surface === "custom"
      ? customDraftValid
      : props.surface === "advance"
        ? advanceDraftValid
        : matchScoreValid;
  const reasonValid = reason.trim().length > 0;
  const lockOk = !lockHasPassed || lockBypassed;
  const canSave = hasDraft && reasonValid && lockOk && !pending;

  function onSavePress() {
    if (!canSave) {
      // Surface the exact gate the user is missing — they can't tell
      // why a generic disabled state isn't lifting.
      if (!hasDraft) {
        setError(
          props.surface === "custom"
            ? isHebrew ? "בחר תשובה" : "Pick an answer"
            : props.surface === "advance"
              ? isHebrew ? "בחר נבחרת" : "Pick a team"
              : isHebrew ? "הזן תוצאה" : "Enter a score",
        );
      } else if (!reasonValid) {
        setError(isHebrew ? "חובה לכתוב סיבה" : "Reason is required");
      } else if (!lockOk) {
        setError(
          isHebrew
            ? "ההימור נעול — סמן 'עוקף את מועד הסגירה'"
            : "Bet is locked — tick 'bypass lock'",
        );
      }
      return;
    }
    if (props.surface === "custom" && customDraft) {
      handleSaveCustom(customDraft);
    } else if (props.surface === "match") {
      handleSaveMatch(Number(matchHome), Number(matchAway));
    } else if (props.surface === "advance" && advanceTeam) {
      handleSaveAdvance(advanceTeam);
    }
  }

  function handleClear() {
    setError(null);
    if (props.surface === "advance" && !actions.clearAdvance) {
      console.error("[admin pick editor] clear_advance missing clearAdvance action");
      setError(isHebrew ? "פעולה לא זמינה" : "Action unavailable");
      return;
    }
    startTransition(async () => {
      const result =
        props.surface === "custom"
          ? await actions.clearCustom({
              targetUserId: props.targetUserId,
              customBetId: props.customBetId,
              reason,
              lockBypassed,
            })
          : props.surface === "advance"
            ? await actions.clearAdvance!({
                targetUserId: props.targetUserId,
                matchId: props.matchId,
                reason,
                lockBypassed,
              })
            : await actions.clearMatch({
                targetUserId: props.targetUserId,
                matchId: props.matchId,
                reason,
                lockBypassed,
              });
      const msg = translateResult(result);
      if (msg) {
        setError(msg);
        return;
      }
      props.onSaved?.();
      props.onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end md:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={isHebrew ? "עריכת הימור עבור משתמש" : "Edit pick for user"}
    >
      <button
        type="button"
        aria-label={isHebrew ? "סגור" : "Close"}
        onClick={props.onClose}
        className="absolute inset-0 bg-on-surface/40 backdrop-blur-[2px] cursor-pointer"
      />
      <div
        ref={dialogRef}
        className="relative w-full md:max-w-md md:rounded-2xl bg-surface-container rounded-t-2xl border-t md:border border-outline-variant shadow-2xl pb-[env(safe-area-inset-bottom)] max-h-[100dvh] overflow-y-auto"
      >
        <header className="sticky top-0 bg-surface-container border-b border-outline-variant px-5 py-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-on-surface min-w-0 truncate">
            {isHebrew ? "ערוך עבור" : "Edit for"}{" "}
            <span className="text-primary">{props.targetUserName}</span>
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={isHebrew ? "סגור" : "Close"}
            className="p-2 rounded-full hover:bg-surface-container-high transition-colors min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
          >
            <XIcon className="h-5 w-5" strokeWidth={2} />
          </button>
        </header>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Question / matchup */}
          <div className="flex flex-col gap-1">
            {props.surface === "advance" && (
              <span className="font-[family-name:var(--font-label)] text-[11px] font-bold uppercase tracking-[0.05em] text-primary">
                {isHebrew ? "מי עולה?" : "Who advances?"}
              </span>
            )}
            <p className="text-sm text-on-surface leading-snug font-medium">
              {props.surface === "custom"
                ? isHebrew
                  ? props.questionHe
                  : props.questionEn
                : isHebrew
                  ? props.matchupHe
                  : props.matchupEn}
            </p>
          </div>

          {/* Answer input — draft only, never fires a save itself. The
              single bottom Save button is the only submit path so the
              user's reason + bypass tick always carry over. */}
          {props.surface === "custom" ? (
            <CustomAnswerInput
              answerType={props.answerType}
              answerConfig={props.answerConfig}
              value={customDraft}
              locale={props.locale}
              pending={pending}
              onChange={setCustomDraft}
            />
          ) : props.surface === "advance" ? (
            <AdvanceTeamInput
              homeCode={props.homeCode}
              awayCode={props.awayCode}
              homeName={isHebrew ? props.homeTeamHe : props.homeTeamEn}
              awayName={isHebrew ? props.awayTeamHe : props.awayTeamEn}
              value={advanceTeam}
              pending={pending}
              onChange={setAdvanceTeam}
            />
          ) : (
            <MatchScoreInput
              home={matchHome}
              away={matchAway}
              locale={props.locale}
              pending={pending}
              onChange={(h, a) => {
                setMatchHome(h);
                setMatchAway(a);
              }}
            />
          )}

          {/* Live-stake picker — how many points to risk. Only for live-scope
              custom bets; mirrors the player card's pill row. */}
          {props.surface === "custom" && showStakePicker && props.stakeBounds && (
            <StakePicker
              locale={props.locale}
              value={chosenStake}
              baseStake={props.stake}
              minStake={props.stakeBounds.minStake}
              maxStake={props.stakeBounds.maxStake}
              disabled={pending}
              onChange={setChosenStake}
            />
          )}

          {/* Reason */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor={reasonId}
              className="font-[family-name:var(--font-label)] text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface-variant"
            >
              {isHebrew ? "סיבה (חובה)" : "Reason (required)"}
            </label>
            <input
              id={reasonId}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isHebrew
                  ? "השלמתי טלפונית לעודד"
                  : "Filled in over the phone for Oded"
              }
              className="min-h-[48px] px-3 rounded-lg border border-outline-variant bg-surface text-base text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
              disabled={pending}
            />
            <p className="text-xs text-on-surface-variant">
              {isHebrew
                ? "נשמר באודיט. לא ניתן לשנות אחרי שמירה."
                : "Stored in the audit log. Permanent after save."}
            </p>
          </div>

          {/* Lock bypass — only when the bet's lock has passed */}
          {lockHasPassed && (
            <label className="flex items-start gap-2 rounded-lg border border-error/40 bg-error-container/30 px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={lockBypassed}
                onChange={(e) => setLockBypassed(e.target.checked)}
                className="mt-1 h-5 w-5 accent-error"
                disabled={pending}
              />
              <span className="text-xs text-error leading-snug">
                <AlertTriangle
                  className="inline h-3.5 w-3.5 me-1 align-text-bottom"
                  strokeWidth={2}
                />
                {isHebrew
                  ? "עוקף את מועד הסגירה. נרשם בנפרד באודיט."
                  : "Bypass the lock deadline. Logged separately in the audit."}
              </span>
            </label>
          )}

          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {error}
            </p>
          )}

          {/* Footer: Clear (destructive, secondary) + Save (primary). The
              Save button is the single submit path — it reads the draft,
              reason, and bypass tick from local state, validates them all
              client-side for clear messaging, then fires the action. */}
          <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-2 pt-3 border-t border-outline-variant">
            <button
              type="button"
              onClick={handleClear}
              disabled={pending || reason.trim().length === 0}
              className={clsx(
                "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-full text-sm font-bold transition-colors",
                "text-error border border-error/30 hover:bg-error-container",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              {isHebrew ? "מחק ניחוש" : "Clear pick"}
            </button>
            <button
              type="button"
              onClick={onSavePress}
              disabled={pending}
              className={clsx(
                "inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-full text-base font-bold transition-colors",
                "bg-primary text-on-primary shadow-md",
                "hover:bg-surface-tint",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                !canSave && !pending && "opacity-60",
              )}
            >
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {pending
                ? isHebrew ? "שומר…" : "Saving…"
                : isHebrew ? "שמור ניחוש" : "Save pick"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomAnswerInput({
  answerType,
  answerConfig,
  value,
  locale,
  pending,
  onChange,
}: {
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  value: PickAnswer | null;
  locale: Locale;
  pending: boolean;
  onChange: (answer: PickAnswer | null) => void;
}) {
  const isHebrew = locale === "he";

  if (answerType === "yes_no") {
    return (
      <div className="flex gap-2">
        {[true, false].map((v) => {
          const active = value?.type === "yes_no" && value.value === v;
          return (
            <button
              key={String(v)}
              type="button"
              onClick={() => onChange({ type: "yes_no", value: v })}
              disabled={pending}
              className={clsx(
                "flex-1 min-h-[48px] rounded-full border text-base font-bold transition-colors",
                active
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface text-on-surface border-outline-variant hover:bg-surface-container-low",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {v ? (isHebrew ? "כן" : "Yes") : isHebrew ? "לא" : "No"}
            </button>
          );
        })}
      </div>
    );
  }

  if (answerType === "multi_choice") {
    const cfg = answerConfig as Partial<MultiChoiceConfig> | null;
    if (cfg?.dynamicSource === "players") {
      return (
        <DynamicPlayerPicker
          locale={locale}
          currentValue={value?.type === "multi_choice" ? value.value : null}
          pending={pending}
          onPick={(v) => onChange({ type: "multi_choice", value: v })}
        />
      );
    }
    const options = cfg?.options ?? [];
    return (
      <div className="flex flex-col gap-2">
        {options.map((o) => {
          const active = value?.type === "multi_choice" && value.value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange({ type: "multi_choice", value: o.value })}
              disabled={pending}
              className={clsx(
                "min-h-[48px] px-4 rounded-full border text-base font-bold transition-colors text-start",
                active
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface text-on-surface border-outline-variant hover:bg-surface-container-low",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {isHebrew ? o.labelHe : o.labelEn}
            </button>
          );
        })}
      </div>
    );
  }

  if (answerType === "number") {
    return (
      <NumberInputRow
        value={value?.type === "number" ? String(value.value) : ""}
        pending={pending}
        onChange={(text) => {
          if (text === "") {
            onChange(null);
            return;
          }
          const n = Number(text);
          if (!Number.isFinite(n)) {
            onChange(null);
            return;
          }
          onChange({ type: "number", value: n });
        }}
      />
    );
  }

  // free_text
  return (
    <FreeTextInputRow
      value={value?.type === "free_text" ? value.value : ""}
      pending={pending}
      onChange={(text) => {
        if (text.trim() === "") {
          onChange(null);
        } else {
          onChange({ type: "free_text", value: text });
        }
      }}
    />
  );
}

// Dynamic-roster picker for the player markets. Hydrates the full WC squad
// from /api/picker-options (cached in memory across opens) and renders the
// shared SearchableChoicePicker — search by name / team / position, chunked
// display, mobile sheet. Selecting a player saves immediately, the same way
// tapping an option in the static button grid does. Clearing inside the
// picker is ignored on purpose: removing a pick goes through the audited
// "Clear pick" button so it carries a reason.
function DynamicPlayerPicker({
  locale,
  currentValue,
  pending,
  onPick,
}: {
  locale: Locale;
  currentValue: string | null;
  pending: boolean;
  onPick: (value: string) => void;
}) {
  const isHebrew = locale === "he";
  const { options, loading, error } = usePickerOptions("players", locale);

  if (loading) {
    return (
      <div className="min-h-[52px] flex items-center justify-center rounded-full border border-outline-variant text-sm text-on-surface-variant">
        {isHebrew ? "טוען שחקנים…" : "Loading players…"}
      </div>
    );
  }
  if (error) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-error">
        <AlertCircle className="h-4 w-4" strokeWidth={2} />
        {isHebrew ? "טעינת רשימת השחקנים נכשלה" : "Failed to load players"}
      </p>
    );
  }
  return (
    <SearchableChoicePicker
      options={options}
      currentValue={currentValue}
      locale={locale}
      disabled={pending}
      lazyChunkSize={20}
      placeholder={isHebrew ? "בחר שחקן…" : "Pick a player…"}
      onChange={(value) => {
        if (value) onPick(value);
      }}
    />
  );
}

function NumberInputRow({
  value,
  pending,
  onChange,
}: {
  value: string;
  pending: boolean;
  onChange: (text: string) => void;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={pending}
      className="w-full min-h-[48px] px-3 rounded-lg border border-outline-variant bg-surface text-base text-on-surface focus:outline-none focus:border-primary"
    />
  );
}

function FreeTextInputRow({
  value,
  pending,
  onChange,
}: {
  value: string;
  pending: boolean;
  onChange: (text: string) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={pending}
      rows={3}
      className="w-full min-h-[80px] px-3 py-2 rounded-lg border border-outline-variant bg-surface text-base text-on-surface focus:outline-none focus:border-primary"
    />
  );
}

// Canonical stake stops, mirrored from the player bet card so the admin sees
// the same row. Filtered to the admin's [min, max] range; the bet's own
// baseStake is always inserted (sorted) even if it's off the canonical list.
const STAKE_STOPS = [1, 3, 5, 10, 20, 30] as const;

function clampStake(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function StakePicker({
  locale,
  value,
  baseStake,
  minStake,
  maxStake,
  disabled,
  onChange,
}: {
  locale: Locale;
  value: number;
  baseStake: number;
  minStake: number;
  maxStake: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const isHebrew = locale === "he";
  const stops = STAKE_STOPS.filter((s) => s >= minStake && s <= maxStake);
  const clampedBase = clampStake(baseStake, minStake, maxStake);
  const stopsWithBase = Array.from(new Set([...stops, clampedBase])).sort(
    (a, b) => a - b,
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wide">
          {isHebrew ? "כמה לסכן?" : "How much to risk?"}
        </span>
        <span className="text-xs text-on-surface-variant tabular-nums">
          {isHebrew
            ? `${minStake}–${maxStake} נק׳`
            : `${minStake}–${maxStake} pts`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {stopsWithBase.map((stop) => {
          const active = stop === value;
          const isDefault = stop === clampedBase;
          return (
            <button
              key={stop}
              type="button"
              disabled={disabled}
              onClick={() => onChange(stop)}
              aria-pressed={active}
              aria-label={
                isHebrew
                  ? `סכן ${stop} נקודות${isDefault ? " (ברירת מחדל)" : ""}`
                  : `Risk ${stop} points${isDefault ? " (default)" : ""}`
              }
              className={clsx(
                "min-h-11 min-w-11 px-3 inline-flex items-center justify-center gap-1 rounded-full border text-sm font-bold tabular-nums transition-colors",
                active
                  ? "bg-primary text-on-primary border-primary shadow-sm"
                  : "bg-surface-container-lowest text-on-surface border-outline hover:border-primary",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {stop}
              {isDefault && (
                <span
                  aria-hidden
                  className={clsx(
                    "text-[10px] font-bold",
                    active ? "text-on-primary/80" : "text-on-surface-variant",
                  )}
                >
                  ★
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Two-team choice for the "who advances?" pick. Full-width stacked buttons so
// the (sometimes long, RTL) team names never truncate on the smallest viewport.
function AdvanceTeamInput({
  homeCode,
  awayCode,
  homeName,
  awayName,
  value,
  pending,
  onChange,
}: {
  homeCode: string;
  awayCode: string;
  homeName: string;
  awayName: string;
  value: string | null;
  pending: boolean;
  onChange: (team: string | null) => void;
}) {
  const teams = [
    { code: homeCode, name: homeName },
    { code: awayCode, name: awayName },
  ];
  return (
    <div className="flex flex-col gap-2">
      {teams.map((t) => {
        const active = value === t.code;
        return (
          <button
            key={t.code}
            type="button"
            onClick={() => onChange(active ? null : t.code)}
            disabled={pending}
            aria-pressed={active}
            className={clsx(
              "min-h-[48px] px-4 rounded-full border text-base font-bold transition-colors text-start inline-flex items-center gap-2",
              active
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface text-on-surface border-outline-variant hover:bg-surface-container-low",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {active && <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} />}
            <span className="min-w-0 truncate">{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function MatchScoreInput({
  home,
  away,
  locale,
  pending,
  onChange,
}: {
  home: string;
  away: string;
  locale: Locale;
  pending: boolean;
  onChange: (home: string, away: string) => void;
}) {
  const isHebrew = locale === "he";
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={home}
        onChange={(e) => onChange(e.target.value, away)}
        aria-label={isHebrew ? "ביתית" : "Home"}
        disabled={pending}
        className="flex-1 min-h-[56px] px-3 rounded-lg border border-outline-variant bg-surface text-2xl font-bold text-center text-on-surface focus:outline-none focus:border-primary tabular-nums"
      />
      <span className="text-xl font-bold text-on-surface-variant" aria-hidden>
        –
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={away}
        onChange={(e) => onChange(home, e.target.value)}
        aria-label={isHebrew ? "חוצית" : "Away"}
        disabled={pending}
        className="flex-1 min-h-[56px] px-3 rounded-lg border border-outline-variant bg-surface text-2xl font-bold text-center text-on-surface focus:outline-none focus:border-primary tabular-nums"
      />
    </div>
  );
}
