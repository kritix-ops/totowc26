"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../../dictionaries";
import { LabelCaps } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import { toast } from "@/lib/toast";
import { buildSystemPrompt, MAX_GUIDANCE_CHARS } from "@/lib/bets/suggest/prompt";
import { setSuggestGuidance, type PromptScopeInfo } from "./actions";

// Inline prompt panel for the suggestions page. Two things, no page hops:
//   1. SEE the full prompt the LLM receives (system + a faithful sample user
//      prompt), per scope, read-only.
//   2. EDIT a SAFE "house guidance" block per scope. It is appended to the
//      system prompt and can only steer selection/wording — buildSystemPrompt
//      fences it below the hard rules, so it can never break the format,
//      schema, grading sources, or the bilingual requirement.
//
// The full-prompt preview recomputes live from the textarea via the same
// buildSystemPrompt the server uses, so what you see is exactly what will be
// sent once you save.

type ScopeKey = "match" | "day";

export function PromptEditor({
  scopes,
  locale,
}: {
  scopes: PromptScopeInfo[];
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const byScope = useMemo(() => {
    const m = new Map<ScopeKey, PromptScopeInfo>();
    for (const s of scopes) m.set(s.scope, s);
    return m;
  }, [scopes]);

  const [active, setActive] = useState<ScopeKey>("match");
  const [texts, setTexts] = useState<Record<ScopeKey, string>>({
    match: byScope.get("match")?.guidance ?? "",
    day: byScope.get("day")?.guidance ?? "",
  });
  const [saved, setSaved] = useState<Record<ScopeKey, string>>({
    match: byScope.get("match")?.guidance ?? "",
    day: byScope.get("day")?.guidance ?? "",
  });
  const [showFull, setShowFull] = useState(false);
  const { pending, run } = usePendingAction();

  const info = byScope.get(active);
  const text = texts[active];
  const dirty = text !== saved[active];

  // The auto-computed data steer for the active scope (pool-wide, so it's the
  // same for match and day). Read-only — the admin sees it but can't edit it.
  const dataGuidance = info?.dataGuidance ?? "";

  // Live preview: same assembly the generator uses, with the current (possibly
  // unsaved) house guidance AND the data steer applied.
  const livePrompt = useMemo(
    () => buildSystemPrompt(active, text, dataGuidance),
    [active, text, dataGuidance],
  );

  const save = () => {
    void run(async () => {
      const res = await setSuggestGuidance(active, text);
      if (res.ok) {
        setSaved((s) => ({ ...s, [active]: text }));
        toast.success(isHebrew ? "ההנחיות נשמרו" : "Guidance saved");
      } else {
        toast.error(
          isHebrew ? "השמירה נכשלה. נסה שוב." : "Save failed. Try again.",
        );
      }
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-primary shrink-0" strokeWidth={1.75} />
        <LabelCaps>{isHebrew ? "פרומפט ה-AI" : "AI prompt"}</LabelCaps>
      </div>
      <p className="text-xs text-on-surface-variant">
        {isHebrew
          ? "כאן רואים את הפרומפט המלא שה-AI מקבל, ואפשר להוסיף הנחיות בית משלך. ההנחיות לא יכולות לעקוף את הכללים הקשיחים."
          : "See the full prompt the AI receives and add your own house guidance. Guidance can't override the hard rules."}
      </p>

      {/* Scope toggle — the match and day prompts have different rules. */}
      <div className="flex gap-2">
        {(["match", "day"] as ScopeKey[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActive(s)}
            className={clsx(
              "press-down min-h-11 px-4 rounded-full border text-sm font-bold",
              active === s
                ? "bg-primary text-on-primary border-primary"
                : "border-outline text-on-surface-variant hover:bg-surface-container",
            )}
          >
            {s === "match"
              ? isHebrew ? "משחק בודד" : "Single match"
              : isHebrew ? "יום שלם" : "Whole day"}
          </button>
        ))}
      </div>

      {/* Data steer (read-only) — auto-computed from the pool's own history. */}
      {dataGuidance && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-outline-variant bg-surface-container p-3">
          <LabelCaps>{isHebrew ? "סטיר מהדאטה (אוטומטי)" : "Data steer (automatic)"}</LabelCaps>
          <p
            className="text-sm text-on-surface-variant whitespace-pre-wrap"
            dir={isHebrew ? "rtl" : "ltr"}
          >
            {dataGuidance}
          </p>
          <p className="text-[11px] text-on-surface-variant">
            {isHebrew
              ? "מחושב אוטומטית מההיסטוריה של הפול (קטגוריות שהחזירו לשחקנים גרוע). מכוון בחירת שווקים בלבד, לא הסתברויות. לא ניתן לעריכה."
              : "Auto-computed from the pool's history (categories that paid players poorly). Steers market selection only, not probabilities. Not editable."}
          </p>
        </div>
      )}

      {/* Editable house guidance. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <LabelCaps>{isHebrew ? "הנחיות בית" : "House guidance"}</LabelCaps>
          <span className="text-[11px] text-on-surface-variant tabular-nums">
            {text.length}/{MAX_GUIDANCE_CHARS}
          </span>
        </div>
        <textarea
          value={text}
          maxLength={MAX_GUIDANCE_CHARS}
          disabled={pending}
          onChange={(e) =>
            setTexts((t) => ({ ...t, [active]: e.target.value }))
          }
          rows={4}
          dir={isHebrew ? "rtl" : "ltr"}
          placeholder={
            isHebrew
              ? "למשל: תעדיף הימורי התפלגות עם הרבה אפשרויות, הימנע מהימורי VAR, ושמור על עברית קלילה."
              : "e.g. prefer many-option distribution markets, avoid VAR bets, keep the Hebrew casual."
          }
          className="min-h-[96px] px-3 py-2 rounded-lg border border-outline bg-surface-container-lowest text-base resize-y focus:outline-none focus:border-primary"
        />
        <p className="inline-flex items-start gap-1.5 text-[11px] text-on-surface-variant">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" strokeWidth={2} />
          <span>
            {isHebrew
              ? "ההנחיות נדבקות לסוף הפרומפט ומכוונות בחירה וניסוח בלבד. הן לא יכולות לשבור את הפורמט, הסכימה, מקורות הגרידינג או הדרישה לעברית+אנגלית. ריק = ללא הנחיות."
              : "Guidance is appended to the prompt and only steers selection/wording. It cannot break the format, schema, grading sources, or the He+En requirement. Empty = none."}
          </span>
        </p>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="press-down min-h-11 px-5 rounded-full bg-primary text-on-primary font-bold text-sm disabled:opacity-50"
          >
            {pending
              ? isHebrew ? "שומר…" : "Saving…"
              : isHebrew ? "שמור הנחיות" : "Save guidance"}
          </button>
          {dirty && !pending && (
            <button
              type="button"
              onClick={() =>
                setTexts((t) => ({ ...t, [active]: saved[active] }))
              }
              className="press-down min-h-11 px-4 rounded-full border border-outline text-sm font-bold text-on-surface-variant hover:bg-surface-container"
            >
              {isHebrew ? "בטל שינויים" : "Discard"}
            </button>
          )}
        </div>
      </div>

      {/* Read-only full prompt, collapsible. */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowFull((v) => !v)}
          aria-expanded={showFull}
          className="press-down inline-flex items-center gap-1.5 min-h-11 px-3 w-fit rounded-full border border-outline text-sm font-bold text-on-surface-variant hover:bg-surface-container"
        >
          {showFull ? (
            <ChevronUp className="h-4 w-4 shrink-0" strokeWidth={2} />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={2} />
          )}
          {showFull
            ? isHebrew ? "הסתר את הפרומפט המלא" : "Hide the full prompt"
            : isHebrew ? "הצג את הפרומפט המלא שה-AI מקבל" : "Show the full prompt the AI receives"}
        </button>

        {showFull && (
          <div className="flex flex-col gap-3">
            <PromptBlock
              title={isHebrew ? "הוראות מערכת (System)" : "System prompt"}
              body={livePrompt}
              isHebrew={isHebrew}
            />
            <PromptBlock
              title={isHebrew ? "פרומפט המשתמש (דוגמה)" : "User prompt (sample)"}
              body={info?.userPromptSample ?? ""}
              isHebrew={isHebrew}
            />
          </div>
        )}
      </div>
    </section>
  );
}

// One read-only, scrollable prompt block with a copy button. The prompt is
// mostly English, so it reads LTR even in the Hebrew UI.
function PromptBlock({
  title,
  body,
  isHebrew,
}: {
  title: string;
  body: string;
  isHebrew: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      .writeText(body)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        toast.error(isHebrew ? "ההעתקה נכשלה" : "Copy failed");
      });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <LabelCaps>{title}</LabelCaps>
        <button
          type="button"
          onClick={copy}
          className="press-down inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border border-outline text-xs font-bold text-on-surface-variant hover:bg-surface-container"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.25} />
          ) : (
            <Copy className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          )}
          {copied
            ? isHebrew ? "הועתק" : "Copied"
            : isHebrew ? "העתק" : "Copy"}
        </button>
      </div>
      <pre
        dir="ltr"
        className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-outline-variant bg-surface-container p-3 text-[12px] leading-5 text-on-surface font-mono"
      >
        {body}
      </pre>
    </div>
  );
}
