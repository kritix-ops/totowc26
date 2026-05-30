"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, Save, Send, Unlock } from "lucide-react";
import { Chip, LabelCaps, PillButton } from "@/components/ui";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { OutrightSurface } from "@/db/schema";
import {
  publishSurfaceToBet,
  toggleRowAdminOverride,
  updateRowDecimalOdds,
} from "./actions";

// Single-surface editor: row list with inline decimal_odds edit + admin
// override pin, and a publish-to-bet panel at the bottom. Mobile-first
// stacked cards under md, full table at md+.
//
// Why one component for both views: keeping the row state in one place
// lets a saved edit flip the on-screen "modified" indicator and the
// admin_override badge together, and the publish panel can show a live
// count of "currently dirty" rows so the admin knows to save first.

export type RowVM = {
  id: string;
  optionKind: "player" | "team";
  optionId: number;
  displayName: string;
  decimalOdds: number;
  source: string;
  adminOverride: boolean;
  notes: string;
};

export type PublishableBetVM = {
  id: string;
  questionHe: string;
  questionEn: string;
  status: string;
  scope: string | null;
};

export function SurfaceEditor({
  locale,
  surface,
  rows,
  publishableBets,
}: {
  locale: Locale;
  surface: OutrightSurface;
  rows: RowVM[];
  publishableBets: PublishableBetVM[];
}) {
  const isHebrew = locale === "he";

  if (rows.length === 0) {
    return (
      <div className="text-sm text-on-surface-variant py-6 text-center">
        {isHebrew
          ? "אין שורות לשטח הזה. הרץ npm run outright:ingest כדי לייבא."
          : "No rows for this surface. Run npm run outright:ingest to import."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <RowItem locale={locale} row={row} />
          </li>
        ))}
      </ol>

      <PublishPanel
        locale={locale}
        surface={surface}
        publishableBets={publishableBets}
        rowCount={rows.length}
      />
    </div>
  );
}

function RowItem({ locale, row }: { locale: Locale; row: RowVM }) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftOdds, setDraftOdds] = useState(row.decimalOdds.toString());
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const parsedDraft = Number(draftOdds);
  const dirty =
    Number.isFinite(parsedDraft) && Math.abs(parsedDraft - row.decimalOdds) > 0.0005;
  const validDraft =
    Number.isFinite(parsedDraft) && parsedDraft > 1 && parsedDraft <= 1000;

  function save() {
    if (!validDraft) {
      setError(isHebrew ? "ערך לא חוקי (חייב 1.01-1000)" : "invalid (1.01-1000)");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateRowDecimalOdds({
        rowId: row.id,
        decimalOdds: parsedDraft,
        adminOverride: true,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        setSavedAt(Date.now());
        router.refresh();
      }
    });
  }

  function toggleLock() {
    setError(null);
    startTransition(async () => {
      const res = await toggleRowAdminOverride({
        rowId: row.id,
        adminOverride: !row.adminOverride,
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant md:flex-row md:items-center md:gap-4">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-sm md:text-base font-bold truncate">
          {row.displayName}
        </span>
        {row.adminOverride && (
          <Chip className="text-[10px] inline-flex items-center gap-1">
            <Lock className="h-3 w-3" strokeWidth={2} />
            {isHebrew ? "נעול" : "pinned"}
          </Chip>
        )}
      </div>

      <div className="flex items-center gap-2 md:w-auto md:justify-end">
        <label className="flex flex-col gap-1 w-32">
          <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">
            {isHebrew ? "decimal odds" : "decimal odds"}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={1.01}
            max={1000}
            dir="ltr"
            value={draftOdds}
            onChange={(e) => setDraftOdds(e.target.value)}
            className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums focus:outline-none focus:border-primary"
          />
        </label>

        <PillButton
          variant="primary"
          onClick={save}
          disabled={pending || !dirty || !validDraft}
          aria-label={isHebrew ? "שמור שורה" : "Save row"}
        >
          <Save className="h-4 w-4" strokeWidth={2} />
          <span className="ml-1 hidden sm:inline">
            {isHebrew ? "שמור" : "Save"}
          </span>
        </PillButton>

        <PillButton
          variant="ghost"
          onClick={toggleLock}
          disabled={pending}
          aria-label={
            row.adminOverride
              ? isHebrew ? "פתח נעילה" : "Unpin"
              : isHebrew ? "נעל ערך" : "Pin"
          }
        >
          {row.adminOverride ? (
            <Unlock className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Lock className="h-4 w-4" strokeWidth={2} />
          )}
        </PillButton>
      </div>

      {(error || savedAt) && (
        <div className="w-full text-xs">
          {error && <span className="text-error">{error}</span>}
          {!error && savedAt && (
            <span className="text-success inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
              {isHebrew ? "נשמר" : "Saved"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PublishPanel({
  locale,
  surface,
  publishableBets,
  rowCount,
}: {
  locale: Locale;
  surface: OutrightSurface;
  publishableBets: PublishableBetVM[];
  rowCount: number;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>("");
  const [result, setResult] = useState<
    | null
    | { kind: "ok"; updated: number; longshot: number }
    | { kind: "err"; error: string }
  >(null);

  function publish() {
    if (!selected) return;
    setResult(null);
    startTransition(async () => {
      const res = await publishSurfaceToBet({
        surface,
        customBetId: selected,
      });
      if (res.ok) {
        setResult({
          kind: "ok",
          updated: res.data.updated,
          longshot: res.data.longshot,
        });
        router.refresh();
      } else {
        setResult({ kind: "err", error: res.error });
      }
    });
  }

  if (publishableBets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-outline-variant p-3 text-xs text-on-surface-variant">
        {isHebrew
          ? "אין הימור multi_choice במצב draft/open/locked לפרסם אליו. צור הימור קודם."
          : "No multi_choice bet in draft/open/locked status to publish into. Create one first."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg bg-surface-container-high border border-outline-variant">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-bold text-sm">
          {isHebrew ? "פרסם ל-הימור" : "Publish into bet"}
        </span>
        <LabelCaps>
          {rowCount} {isHebrew ? "אופציות במלאי" : "options in snapshot"}
        </LabelCaps>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">
          {isHebrew ? "הימור יעד" : "Target bet"}
        </span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base focus:outline-none focus:border-primary"
        >
          <option value="">
            {isHebrew ? "— בחר הימור —" : "— pick a bet —"}
          </option>
          {publishableBets.map((b) => (
            <option key={b.id} value={b.id}>
              [{b.status}] {isHebrew ? b.questionHe : b.questionEn}
            </option>
          ))}
        </select>
      </label>

      <PillButton
        variant="primary"
        onClick={publish}
        disabled={pending || !selected}
      >
        <Send className="h-4 w-4" strokeWidth={2} />
        <span className="ml-1">{isHebrew ? "פרסם" : "Publish"}</span>
      </PillButton>

      {result?.kind === "ok" && (
        <p className="text-xs text-success inline-flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
          {isHebrew
            ? `פורסם: ${result.updated} אופציות מתומחרות, ${result.longshot} נשארו לongshot ברירת מחדל`
            : `Published: ${result.updated} priced, ${result.longshot} got longshot default`}
        </p>
      )}
      {result?.kind === "err" && (
        <p className="text-xs text-error">{result.error}</p>
      )}
    </div>
  );
}
