"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertCircle, Check, Megaphone } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import type { Locale } from "../../dictionaries";
import {
  sendBroadcast,
  type BroadcastTarget,
  type SendBroadcastResult,
} from "./actions";

type Recipient = {
  id: string;
  displayName: string;
  email: string | null;
  pushOptIn: boolean;
  subscriptionCount: number;
};

type Mode = "user" | "all-opted-in" | "all-players";

export function BroadcastForm({
  locale,
  recipients,
  optedInCount,
  totalPlayers,
  pushAvailable,
}: {
  locale: Locale;
  recipients: Recipient[];
  optedInCount: number;
  totalPlayers: number;
  pushAvailable: boolean;
}) {
  const isHebrew = locale === "he";
  const [mode, setMode] = useState<Mode>("all-players");
  const [userId, setUserId] = useState<string>(recipients[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [push, setPush] = useState<boolean>(pushAvailable);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendBroadcastResult | null>(null);

  const recipientsById = useMemo(() => {
    const m = new Map<string, Recipient>();
    for (const r of recipients) m.set(r.id, r);
    return m;
  }, [recipients]);
  const selected = userId ? recipientsById.get(userId) : null;

  const formInvalid =
    title.trim().length === 0 ||
    body.trim().length === 0 ||
    (mode === "user" && !selected);

  function onSend() {
    setError(null);
    setResult(null);
    let target: BroadcastTarget;
    if (mode === "user") target = { kind: "user", userId };
    else if (mode === "all-opted-in") target = { kind: "all-opted-in" };
    else target = { kind: "all-players" };
    startTransition(async () => {
      const res = await sendBroadcast({
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || undefined,
        target,
        push: pushAvailable && push,
      });
      if (!res.ok) setError(res.error);
      else {
        setResult(res);
        // Clear inputs only on success so the admin can immediately
        // see "delivered to N" and adjust if needed.
        setTitle("");
        setBody("");
        setUrl("");
      }
    });
  }

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-5">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "כתוב הודעה" : "Compose"}
      </SectionHeading>

      {/* Target picker */}
      <div className="flex flex-col gap-2">
        <span className="font-bold text-sm text-on-surface">
          {isHebrew ? "אל מי לשלוח" : "Who receives"}
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <ModeOption
            active={mode === "all-players"}
            onClick={() => setMode("all-players")}
            title={
              isHebrew
                ? `כולם (${totalPlayers})`
                : `Everyone (${totalPlayers})`
            }
            subtitle={
              isHebrew
                ? "כל משתתף יקבל שורה במסך ההתראות שלו"
                : "Every player gets the message in their feed"
            }
          />
          <ModeOption
            active={mode === "all-opted-in"}
            onClick={() => setMode("all-opted-in")}
            title={
              isHebrew
                ? `opt-in (${optedInCount})`
                : `Push opt-in (${optedInCount})`
            }
            subtitle={
              isHebrew
                ? "רק מי שהפעיל push בפרופיל"
                : "Only players with push opt-in on"
            }
          />
          <ModeOption
            active={mode === "user"}
            onClick={() => setMode("user")}
            title={isHebrew ? "משתתף יחיד" : "Single player"}
            subtitle={
              isHebrew
                ? "בחר אדם מהרשימה"
                : "Pick from the dropdown"
            }
          />
        </div>
      </div>

      {/* User dropdown when target=user */}
      {mode === "user" && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="bcast-user"
            className="font-bold text-sm text-on-surface"
          >
            {isHebrew ? "בחר משתתף" : "Pick a player"}
          </label>
          <select
            id="bcast-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold focus:outline-none focus:border-primary"
          >
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.displayName}
                {r.email ? ` - ${r.email}` : ""}
                {r.subscriptionCount > 0
                  ? isHebrew ? "  · push פעיל" : "  · push active"
                  : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Title + body */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="bcast-title"
          className="font-bold text-sm text-on-surface"
        >
          {isHebrew ? "כותרת" : "Title"}
        </label>
        <input
          id="bcast-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          placeholder={isHebrew ? "טוטו מונדיאל" : "Toto Mundial"}
          className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base focus:outline-none focus:border-primary"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="bcast-body"
          className="font-bold text-sm text-on-surface"
        >
          {isHebrew ? "תוכן ההודעה" : "Body"}
        </label>
        <textarea
          id="bcast-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={1000}
          required
          placeholder={
            isHebrew
              ? "הזן את גוף ההודעה. יישמר במסך ההתראות של הנמענים."
              : "Body text. Lands in the recipient's notifications feed."
          }
          className="px-3 py-2 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base focus:outline-none focus:border-primary resize-y"
        />
        <span className="text-[11px] text-on-surface-variant">
          {body.length}/1000
        </span>
      </div>

      {/* Optional URL */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="bcast-url"
          className="font-bold text-sm text-on-surface"
        >
          {isHebrew ? "קישור (אופציונלי)" : "Link (optional)"}
        </label>
        <input
          id="bcast-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="/he/bets/tournament"
          dir="ltr"
          className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base focus:outline-none focus:border-primary"
        />
        <span className="text-[11px] text-on-surface-variant">
          {isHebrew
            ? "לחיצה על ההתראה תפנה לכאן. אם ריק, נפנה ל-/he."
            : "Tap on the notification opens this URL. Defaults to /he."}
        </span>
      </div>

      {/* Push toggle */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={pushAvailable && push}
          disabled={!pushAvailable}
          onChange={(e) => setPush(e.target.checked)}
          className="mt-1 h-5 w-5 accent-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-bold text-sm text-on-surface">
            {isHebrew ? "גם שלח push" : "Also send push"}
          </span>
          <span className="text-[11px] text-on-surface-variant">
            {pushAvailable
              ? isHebrew
                ? "התראת מערכת מיידית לכל מי שיש לו subscription פעיל ו-opt-in מאופשר."
                : "Immediate system notification to every recipient with an active subscription and opt-in on."
              : isHebrew
                ? "VAPID לא מוגדר. ההודעה תישמר רק במסך ההתראות."
                : "VAPID isn't configured. The message goes to the feed only."}
          </span>
        </span>
      </label>

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
                ? `נשמר ל-${result.result.inserted} משתתפים`
                : `Stored for ${result.result.inserted} players`}
              {result.result.pushAttempted > 0 && (
                <span>
                  {isHebrew
                    ? ` · push: ${result.result.pushSent}/${result.result.pushAttempted}`
                    : ` · push: ${result.result.pushSent}/${result.result.pushAttempted}`}
                </span>
              )}
              {result.result.pushExpired > 0 && (
                <span className="text-tertiary">
                  {isHebrew
                    ? ` · ${result.result.pushExpired} מנויים שפגו נוקו`
                    : ` · ${result.result.pushExpired} dead cleaned`}
                </span>
              )}
            </p>
          )}
        </div>
        <PillButton
          type="button"
          disabled={pending || formInvalid}
          onClick={onSend}
          className={clsx(
            "px-8 py-3 inline-flex items-center gap-2",
            (pending || formInvalid) && "opacity-60 cursor-not-allowed",
          )}
        >
          <Megaphone className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          {pending
            ? isHebrew ? "שולח..." : "Sending..."
            : isHebrew ? "שלח הודעה" : "Broadcast"}
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

function translateError(code: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    invalid: [
      "חסר טקסט בכותרת או בגוף, או שהנמען לא קיים.",
      "Missing title/body, or recipient not found.",
    ],
    unauthorized: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאות אדמין", "Admin role required"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return (map[code] ?? map.db)[isHebrew ? 0 : 1];
}
