"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Bell, Check } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import type { Locale } from "../../dictionaries";
import {
  sendTestPush,
  type SendTestPushResult,
  type PushTarget,
} from "./actions";

type Candidate = {
  id: string;
  displayName: string;
  pushOptIn: boolean;
  subscriptionCount: number;
};

type Props = {
  locale: Locale;
  candidates: Candidate[];
  optedInCount: number;
};

type Mode = "user" | "all-opted-in";

export function PushTestForm({ locale, candidates, optedInCount }: Props) {
  const isHebrew = locale === "he";
  const [mode, setMode] = useState<Mode>("user");
  const [userId, setUserId] = useState<string>(candidates[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendTestPushResult | null>(null);

  const candidatesById = useMemo(() => {
    const m = new Map<string, Candidate>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  const selected = userId ? candidatesById.get(userId) : null;
  const cannotSendUser = mode === "user" && !selected;
  const cannotSendAll = mode === "all-opted-in" && optedInCount === 0;
  const cannotSend = cannotSendUser || cannotSendAll;

  function onSend() {
    setError(null);
    setResult(null);
    const target: PushTarget =
      mode === "user"
        ? { kind: "user", userId }
        : { kind: "all-opted-in" };
    void run(async () => {
      const res = await sendTestPush(target, { title, body });
      if (!res.ok) {
        setError(res.error);
      } else {
        setResult(res);
      }
    });
  }

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-5">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "שליחת בדיקה" : "Send test"}
      </SectionHeading>

      {/* Mode picker */}
      <div className="flex flex-col gap-2">
        <span className="font-bold text-sm text-on-surface">
          {isHebrew ? "אל מי לשלוח" : "Who receives this"}
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ModeOption
            active={mode === "user"}
            onClick={() => setMode("user")}
            title={isHebrew ? "משתתף אחד" : "Single player"}
            subtitle={
              isHebrew
                ? "כולל שליחה לעצמך כדי לראות איך זה נראה במכשיר"
                : "Including yourself, to see how it looks on-device"
            }
          />
          <ModeOption
            active={mode === "all-opted-in"}
            onClick={() => setMode("all-opted-in")}
            title={
              isHebrew
                ? `כולם עם opt-in (${optedInCount})`
                : `Everyone opted in (${optedInCount})`
            }
            subtitle={
              isHebrew
                ? "מכבד את ה-opt-in בפרופיל. עוקף את חלון התזכורות ואת ה-dedup."
                : "Honors the opt-in flag. Bypasses reminder window and dedup."
            }
          />
        </div>
      </div>

      {/* User picker (visible only in user mode) */}
      {mode === "user" && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="push-test-user"
            className="font-bold text-sm text-on-surface"
          >
            {isHebrew ? "בחר משתתף" : "Pick a player"}
          </label>
          {candidates.length === 0 ? (
            <p className="text-sm text-on-surface-variant italic">
              {isHebrew
                ? "אף משתתף עדיין לא נרשם ל-push."
                : "No players have subscribed to push yet."}
            </p>
          ) : (
            <>
              <select
                id="push-test-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold focus:outline-none focus:border-primary"
              >
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} ({c.subscriptionCount}
                    {c.pushOptIn ? "" : isHebrew ? ", כבוי" : ", off"})
                  </option>
                ))}
              </select>
              {selected && !selected.pushOptIn && (
                <p className="text-[11px] text-tertiary">
                  {isHebrew
                    ? "שים לב: ה-opt-in של המשתתף הזה כבוי. הבדיקה תישלח למנוי עצמו ועוקפת את הדגל - הוא יקבל את ההתראה."
                    : "Note: this player has opt-in off. The test bypasses that flag and will deliver to their device."}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Optional title/body */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="push-test-title"
            className="font-bold text-sm text-on-surface"
          >
            {isHebrew ? "כותרת (אופציונלי)" : "Title (optional)"}
          </label>
          <input
            id="push-test-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isHebrew ? "טוטו מונדיאל - בדיקה" : "Toto Mundial - test"}
            className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="push-test-body"
            className="font-bold text-sm text-on-surface"
          >
            {isHebrew ? "תוכן (אופציונלי)" : "Body (optional)"}
          </label>
          <input
            id="push-test-body"
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              isHebrew
                ? "התראת בדיקה. אם רואים את זה, push עובד."
                : "Test notification. If you see this, push works."
            }
            className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Send + result */}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-outline-variant">
        <div className="min-h-[24px] flex-1">
          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {translateError(error, isHebrew)}
            </p>
          )}
          {result?.ok && (
            <p className="inline-flex items-center gap-1.5 text-sm text-secondary flex-wrap">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew
                ? `נשלח: ${result.sent}/${result.attempted}`
                : `Sent: ${result.sent}/${result.attempted}`}
              {result.failed > 0 && (
                <span className="text-error">
                  {isHebrew
                    ? ` · נכשלו: ${result.failed}`
                    : ` · failed: ${result.failed}`}
                </span>
              )}
              {result.expired > 0 && (
                <span className="text-tertiary">
                  {isHebrew
                    ? ` · ${result.expired} מנויים שפגו נוקו`
                    : ` · ${result.expired} dead subs cleaned`}
                </span>
              )}
            </p>
          )}
        </div>
        <PillButton
          type="button"
          disabled={pending || cannotSend}
          onClick={onSend}
          className={clsx(
            "px-8 py-3 inline-flex items-center gap-2",
            (pending || cannotSend) && "opacity-60 cursor-not-allowed",
          )}
        >
          <Bell className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          {pending
            ? isHebrew ? "שולח..." : "Sending..."
            : isHebrew ? "שלח push" : "Send push"}
        </PillButton>
      </div>
    </Card>
  );
}

function ModeOption({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={clsx(
        "text-start min-h-[64px] px-4 py-3 rounded-lg border text-sm transition-colors",
        active
          ? "bg-primary text-on-primary border-primary"
          : "bg-surface-container-lowest text-on-surface border-outline hover:bg-surface-container",
      )}
    >
      <span className="block font-bold mb-1">{title}</span>
      <span
        className={clsx(
          "block text-[11px] leading-snug",
          active ? "text-on-primary/80" : "text-on-surface-variant",
        )}
      >
        {subtitle}
      </span>
    </button>
  );
}

// Overrides the COMMON wording with send-failure copy ("Send failed"
// instead of "Save failed") + the push-test-specific codes. Also keeps
// the historical "unauthorized" alias the server action returns.
const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  invalid:      ["בחירה לא תקינה", "Invalid selection"],
  db:           ["שגיאת שליחה", "Send failed"],
  unauthorized: ["יש להתחבר", "Sign in required"],
  no_subscriptions: [
    "אין מנויים תואמים - בחר משתתף אחר או בקש מהמשתתפים להפעיל push.",
    "No matching subscriptions — pick another player or ask players to enable push.",
  ],
  vapid_missing: [
    "VAPID לא מוגדר. הרץ pnpm push:vapid והוסף את שלושת המפתחות.",
    "VAPID env not configured. Run pnpm push:vapid and add all three keys.",
  ],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(code: string, isHebrew: boolean): string {
  return translateAdminError(code in ERROR_MAP ? code : "db", ERROR_MAP, isHebrew);
}
