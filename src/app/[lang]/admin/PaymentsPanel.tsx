"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, RotateCcw, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import { Card, Chip, LabelCaps, SectionHeading } from "@/components/ui";
import type { Locale } from "../dictionaries";
import type { AdminPaymentRow } from "@/db/admin-queries";
import {
  approvePayment,
  rejectPayment,
  reopenPayment,
} from "./payment-actions";

type Filter = "pending" | "all";

export function PaymentsPanel({
  locale,
  rows,
  pendingCount,
  approvedCount,
  rejectedCount,
  approvedSumIls,
}: {
  locale: Locale;
  rows: AdminPaymentRow[];
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  approvedSumIls: number;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("pending");

  const filtered =
    filter === "pending"
      ? rows.filter((r) => r.status === "pending")
      : rows;

  const handle = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const res = await fn();
      setPendingId(null);
      if (!res.ok) {
        setError(
          res.error === "forbidden"
            ? isHebrew ? "אין הרשאה" : "Not allowed"
            : res.error === "not_found"
              ? isHebrew ? "תשלום לא נמצא" : "Payment not found"
              : isHebrew ? "שגיאת שמירה" : "Save failed",
        );
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "תשלומים" : "Payments"}
          </SectionHeading>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "אשר תשלומים שמשתתפים סימנו ככבר שילמו."
              : "Approve payments marked as paid by players."}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-[family-name:var(--font-display)] text-2xl leading-none font-bold text-surface-tint">
            <bdi>{approvedSumIls.toLocaleString()}</bdi>{" "}
            <span className="text-sm text-on-surface-variant">
              {isHebrew ? "ש״ח בקופה" : "ILS pot"}
            </span>
          </span>
          <span className="text-xs text-on-surface-variant">
            {isHebrew
              ? `${pendingCount} ממתינים · ${approvedCount} אושרו · ${rejectedCount} נדחו`
              : `${pendingCount} pending · ${approvedCount} approved · ${rejectedCount} rejected`}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <FilterPill
          active={filter === "pending"}
          onClick={() => setFilter("pending")}
          label={isHebrew ? `ממתינים (${pendingCount})` : `Pending (${pendingCount})`}
        />
        <FilterPill
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label={isHebrew ? "הכל" : "All"}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-error-container text-on-error-container text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-on-surface-variant py-6 text-center">
          {filter === "pending"
            ? isHebrew ? "אין תשלומים ממתינים" : "No pending payments"
            : isHebrew ? "אין תשלומים עדיין" : "No payments yet"}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((p) => (
            <PaymentRow
              key={p.id}
              row={p}
              isHebrew={isHebrew}
              pending={pendingId === p.id || transitioning && pendingId === p.id}
              onApprove={() => handle(p.id, () => approvePayment(p.id))}
              onReject={() => handle(p.id, () => rejectPayment(p.id))}
              onReopen={() => handle(p.id, () => reopenPayment(p.id))}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "press-down min-h-[40px] px-4 rounded-full font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] transition-colors",
        active
          ? "bg-primary text-on-primary"
          : "bg-surface-container-lowest text-on-surface border border-outline hover:bg-surface-container",
      )}
    >
      {label}
    </button>
  );
}

function PaymentRow({
  row,
  isHebrew,
  pending,
  onApprove,
  onReject,
  onReopen,
}: {
  row: AdminPaymentRow;
  isHebrew: boolean;
  pending: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReopen: () => void;
}) {
  const submittedFmt = new Intl.DateTimeFormat(isHebrew ? "he-IL" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(row.submittedAt));

  return (
    <li
      className={clsx(
        "flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border bg-surface-container-lowest transition-colors",
        row.status === "pending"
          ? "border-outline"
          : row.status === "approved"
            ? "border-secondary-fixed-dim opacity-90"
            : "border-error opacity-80",
        pending && "opacity-50",
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div
          className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center font-bold text-on-surface shrink-0"
          aria-hidden
        >
          {row.displayName.charAt(0)}
        </div>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="font-bold text-base truncate">{row.displayName}</span>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone={row.method === "bit" ? "primary" : "warning"}>
              {row.method === "bit"
                ? isHebrew ? "ביט" : "Bit"
                : isHebrew ? "פייבוקס" : "Paybox"}
            </Chip>
            <span className="text-xs text-on-surface-variant whitespace-nowrap">
              {submittedFmt}
            </span>
            {row.phone && (
              <span className="text-xs text-on-surface-variant truncate bidi-ltr">
                {row.phone}
              </span>
            )}
          </div>
          {row.status !== "pending" && (
            <span className="text-xs text-on-surface-variant">
              {row.status === "approved"
                ? isHebrew ? "אושר" : "Approved"
                : isHebrew ? "נדחה" : "Rejected"}
              {row.decidedByName ? ` · ${row.decidedByName}` : ""}
            </span>
          )}
        </div>
        <span className="font-[family-name:var(--font-display)] text-lg font-bold text-on-surface shrink-0 whitespace-nowrap">
          <bdi>{row.amountIls}</bdi>{" "}
          <span className="text-xs text-on-surface-variant">
            {isHebrew ? "ש״ח" : "ILS"}
          </span>
        </span>
      </div>
      <div className="flex gap-2 sm:shrink-0 justify-end">
        {row.status === "pending" ? (
          <>
            <ActionButton
              tone="approve"
              onClick={onApprove}
              disabled={pending}
              ariaLabel={isHebrew ? "אשר" : "Approve"}
            >
              <Check className="h-5 w-5" strokeWidth={2.5} />
            </ActionButton>
            <ActionButton
              tone="reject"
              onClick={onReject}
              disabled={pending}
              ariaLabel={isHebrew ? "דחה" : "Reject"}
            >
              <X className="h-5 w-5" strokeWidth={2.5} />
            </ActionButton>
          </>
        ) : (
          <ActionButton
            tone="neutral"
            onClick={onReopen}
            disabled={pending}
            ariaLabel={isHebrew ? "פתח מחדש" : "Reopen"}
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
          </ActionButton>
        )}
      </div>
    </li>
  );
}

function ActionButton({
  tone,
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  tone: "approve" | "reject" | "neutral";
  onClick: () => void;
  disabled: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "press-down min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        tone === "approve" && "bg-secondary text-on-secondary hover:brightness-105",
        tone === "reject" &&
          "bg-surface-container-lowest border border-outline text-error hover:bg-error-container",
        tone === "neutral" &&
          "bg-surface-container-lowest border border-outline text-on-surface-variant hover:bg-surface-container",
      )}
    >
      {children}
    </button>
  );
}
