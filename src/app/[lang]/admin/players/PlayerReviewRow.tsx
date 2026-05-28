"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Lock, Pencil, X } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { AdminPlayerReviewRow } from "@/db/admin-queries";
import { Card } from "@/components/ui";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import {
  approveTranslation,
  rejectTranslation,
  setManualHebrewName,
} from "./actions";

// One row in the /admin/players review queue. Renders:
//   * Photo (if API gave us one)
//   * English name + team chip + jersey + position
//   * Current Hebrew name (or "—" if null) with an inline edit
//     toggle next to it
//   * Source badge + confidence bar + verdict pill + locked icon
//   * Three action buttons: Approve / Edit / Reject
//
// Edit mode swaps the Hebrew name span for an <input>. Saving
// calls setManualHebrewName which writes name_he, locks the row,
// and marks the verdict approved. Reject clears the Hebrew name
// so the next pipeline run will redo it from scratch.

export function PlayerReviewRow({
  locale,
  row,
}: {
  locale: Locale;
  row: AdminPlayerReviewRow;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.nameHe ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submitEdit = () => {
    setError(null);
    const trimmed = draft.trim();
    if (trimmed.length < 1) {
      setError(isHebrew ? "השדה ריק" : "Empty");
      return;
    }
    startTransition(async () => {
      const res = await setManualHebrewName(row.id, trimmed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const submitApprove = () => {
    setError(null);
    startTransition(async () => {
      const res = await approveTranslation(row.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const submitReject = () => {
    setError(null);
    startTransition(async () => {
      const res = await rejectTranslation(row.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  // Mobile layout: photo + names on top row; meta + actions below.
  // Desktop layout: photo on the left; the rest in a 3-column grid.
  return (
    <li>
      <Card className="p-3 md:p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3 md:gap-4">
          <PlayerPhoto row={row} />

          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex flex-col gap-0.5">
                <span className="text-sm md:text-base font-bold text-on-surface truncate">
                  {row.nameEn}
                </span>
                <span className="text-xs text-on-surface-variant truncate">
                  <span className="me-1">{row.teamFlag}</span>
                  <bdi>{isHebrew ? row.teamNameHe : row.teamNameEn}</bdi>
                  {row.jerseyNumber != null && (
                    <span className="mx-1.5 opacity-60">·</span>
                  )}
                  {row.jerseyNumber != null && (
                    <span className="tabular-nums bidi-ltr">#{row.jerseyNumber}</span>
                  )}
                  {row.position && (
                    <span className="mx-1.5 opacity-60">·</span>
                  )}
                  {row.position && <span className="bidi-ltr">{row.position}</span>}
                </span>
              </div>
              <Verdict
                verdict={row.nameHeReviewVerdict}
                locked={row.nameHeAdminLocked}
                isHebrew={isHebrew}
              />
            </div>

            <HebrewNameField
              editing={editing}
              draft={draft}
              setDraft={setDraft}
              nameHe={row.nameHe}
              isHebrew={isHebrew}
              pending={pending}
              onCancel={() => {
                setEditing(false);
                setDraft(row.nameHe ?? "");
                setError(null);
              }}
              onSave={submitEdit}
            />

            <Meta row={row} isHebrew={isHebrew} />
          </div>
        </div>

        {error && (
          <p className="inline-flex items-center gap-1.5 text-xs text-error">
            <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
            {translateError(error, isHebrew)}
          </p>
        )}

        {!editing && (
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button
              type="button"
              onClick={submitReject}
              disabled={pending}
              className={clsx(
                "press-down inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-bold border",
                "bg-surface-container-lowest text-error border-error/40 hover:bg-error-container",
                pending && "opacity-60 cursor-not-allowed",
              )}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              {isHebrew ? "דחה" : "Reject"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setDraft(row.nameHe ?? "");
              }}
              disabled={pending}
              className={clsx(
                "press-down inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-bold border",
                "bg-surface-container-lowest text-on-surface border-outline hover:bg-surface-container",
                pending && "opacity-60 cursor-not-allowed",
              )}
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
              {isHebrew ? "ערוך" : "Edit"}
            </button>
            <button
              type="button"
              onClick={submitApprove}
              disabled={pending || !row.nameHe}
              title={!row.nameHe ? (isHebrew ? "אין שם עברי לאשר" : "No Hebrew name to approve") : ""}
              className={clsx(
                "press-down inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-bold border",
                "bg-secondary-container text-on-secondary-container border-secondary-fixed hover:brightness-105",
                (pending || !row.nameHe) && "opacity-60 cursor-not-allowed",
              )}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              {isHebrew ? "אשר" : "Approve"}
            </button>
          </div>
        )}
      </Card>
    </li>
  );
}

function PlayerPhoto({ row }: { row: AdminPlayerReviewRow }) {
  if (!row.photoUrl) {
    return (
      <div
        className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-surface-container-high flex items-center justify-center shrink-0 text-on-surface-variant font-bold text-base"
        aria-hidden
      >
        {row.nameEn.charAt(0)}
      </div>
    );
  }
  return (
    <Image
      src={row.photoUrl}
      alt=""
      width={64}
      height={64}
      sizes="(max-width: 768px) 56px, 64px"
      className="w-14 h-14 md:w-16 md:h-16 rounded-full object-cover shrink-0 bg-surface-container-high"
    />
  );
}

function Verdict({
  verdict,
  locked,
  isHebrew,
}: {
  verdict: "approved" | "flag" | "reject" | null;
  locked: boolean;
  isHebrew: boolean;
}) {
  const map: Record<string, { palette: string; labelHe: string; labelEn: string }> = {
    approved: {
      palette: "bg-secondary-container text-on-secondary-container border-secondary-fixed",
      labelHe: "מאושר",
      labelEn: "Approved",
    },
    flag: {
      palette: "bg-tertiary-container text-on-tertiary-container border-tertiary-fixed-dim",
      labelHe: "מסומן",
      labelEn: "Flagged",
    },
    reject: {
      palette: "bg-error-container text-on-error-container border-error",
      labelHe: "דחוי",
      labelEn: "Rejected",
    },
  };
  const meta = verdict ? map[verdict] : null;
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {meta ? (
        <span
          className={`inline-flex items-center h-6 px-2 rounded-full text-[10px] font-bold tracking-[0.05em] uppercase border ${meta.palette}`}
        >
          {isHebrew ? meta.labelHe : meta.labelEn}
        </span>
      ) : (
        <span className="inline-flex items-center h-6 px-2 rounded-full text-[10px] font-bold tracking-[0.05em] uppercase border bg-surface-container-lowest text-on-surface-variant border-outline-variant">
          {isHebrew ? "טרם נסקר" : "Unreviewed"}
        </span>
      )}
      {locked && (
        <span
          title={isHebrew ? "נעול לעריכה ידנית" : "Admin-locked"}
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-container text-on-surface-variant border border-outline-variant"
          aria-label={isHebrew ? "נעול לעריכה ידנית" : "Admin-locked"}
        >
          <Lock className="h-3 w-3" strokeWidth={2} />
        </span>
      )}
    </span>
  );
}

function HebrewNameField({
  editing,
  draft,
  setDraft,
  nameHe,
  isHebrew,
  pending,
  onCancel,
  onSave,
}: {
  editing: boolean;
  draft: string;
  setDraft: (v: string) => void;
  nameHe: string | null;
  isHebrew: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (editing) {
    return (
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={100}
          autoFocus
          dir="rtl"
          placeholder={isHebrew ? "שם בעברית" : "Hebrew name"}
          className="flex-1 h-10 px-3 rounded-md border border-primary bg-surface-container-lowest text-base font-bold"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={pending || draft.trim().length === 0}
          className={clsx(
            "press-down inline-flex items-center gap-1.5 px-3 h-10 rounded-md text-xs font-bold",
            "bg-primary text-on-primary",
            (pending || draft.trim().length === 0) && "opacity-60 cursor-not-allowed",
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          {isHebrew ? "שמור" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="press-down inline-flex items-center px-3 h-10 rounded-md text-xs font-bold bg-surface-container text-on-surface border border-outline"
        >
          {isHebrew ? "ביטול" : "Cancel"}
        </button>
      </div>
    );
  }
  return (
    <div className="text-base font-bold text-on-surface">
      {nameHe ? (
        <bdi dir="rtl">{nameHe}</bdi>
      ) : (
        <span className="text-on-surface-variant font-normal">
          {isHebrew ? "- אין עדיין שם בעברית" : "- No Hebrew name yet"}
        </span>
      )}
    </div>
  );
}

function Meta({
  row,
  isHebrew,
}: {
  row: AdminPlayerReviewRow;
  isHebrew: boolean;
}) {
  const sourceLabel = sourceToLabel(row.nameHeSource, isHebrew);
  const conf = row.nameHeConfidence;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
      {sourceLabel && (
        <span className="inline-flex items-center gap-1">
          <span className="opacity-70">{isHebrew ? "מקור" : "Source"}:</span>
          <span className="font-bold tabular-nums bidi-ltr">{sourceLabel}</span>
        </span>
      )}
      {conf != null && (
        <span className="inline-flex items-center gap-1.5">
          <span className="opacity-70">{isHebrew ? "ביטחון" : "Confidence"}:</span>
          <span className="inline-block w-14 h-1.5 rounded-full bg-surface-container-high overflow-hidden" aria-hidden>
            <span
              className={clsx(
                "block h-full",
                conf >= 80 ? "bg-secondary" : conf >= 50 ? "bg-tertiary" : "bg-error",
              )}
              style={{ width: `${Math.max(0, Math.min(100, conf))}%` }}
            />
          </span>
          <span className="font-bold tabular-nums bidi-ltr">{conf}%</span>
        </span>
      )}
      {row.nameHeReviewReason && (
        <span className="text-on-surface-variant truncate">
          <span className="opacity-70">{isHebrew ? "סיבה" : "Reason"}:</span>{" "}
          {row.nameHeReviewReason}
        </span>
      )}
    </div>
  );
}

function sourceToLabel(source: string | null, isHebrew: boolean): string | null {
  if (!source) return null;
  if (!isHebrew) return source;
  const map: Record<string, string> = {
    wikidata:     "ויקינתונים",
    walla:        "וואלה",
    one:          "ONE",
    sport5:       "ספורט 5",
    sport1:       "ספורט 1",
    ynet:         "ynet",
    llm_claude:   "LLM",
    llm_reviewer: "LLM-מבקר",
    manual:       "ידני",
  };
  return map[source] ?? source;
}

const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  invalid:   ["ערך לא תקין", "Invalid input"],
  not_found: ["שורה לא נמצאה", "Row not found"],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(code: string, isHebrew: boolean): string {
  return translateAdminError(code in ERROR_MAP ? code : "db", ERROR_MAP, isHebrew);
}
