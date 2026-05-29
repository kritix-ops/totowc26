"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Phone,
  Mail,
  UserCheck,
  UserX,
  Filter,
} from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../dictionaries";
import { PillButton, Chip, LabelCaps } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { localePath } from "@/lib/paths";
import { usePendingAction } from "@/lib/use-pending-action";
import { approveSignupRequest, rejectSignupRequest } from "./actions";
import type { SignupRequestRow } from "./queries";

type Filter = "pending" | "approved" | "rejected" | "all";

const FILTERS: { key: Filter; he: string; en: string }[] = [
  { key: "pending", he: "ממתינים", en: "Pending" },
  { key: "approved", he: "מאושרים", en: "Approved" },
  { key: "rejected", he: "נדחו", en: "Rejected" },
  { key: "all", he: "הכל", en: "All" },
];

export function SignupRequestsList({
  locale,
  requests,
  filter,
}: {
  locale: Locale;
  requests: SignupRequestRow[];
  filter: Filter;
}) {
  const isHebrew = locale === "he";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-on-surface-variant" strokeWidth={1.75} />
        <LabelCaps>{isHebrew ? "סינון" : "Filter"}</LabelCaps>
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`${localePath(locale, "admin/users")}?tab=requests&status=${f.key}`}
              className={clsx(
                "px-3 py-1.5 rounded-full text-sm border transition-colors min-h-[44px] inline-flex items-center",
                filter === f.key
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container",
              )}
            >
              {isHebrew ? f.he : f.en}
            </Link>
          ))}
        </div>
      </div>

      {requests.length === 0 ? (
        <EmptyState filter={filter} isHebrew={isHebrew} />
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              locale={locale}
              isHebrew={isHebrew}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function RequestCard({
  request,
  locale,
  isHebrew,
}: {
  request: SignupRequestRow;
  locale: Locale;
  isHebrew: boolean;
}) {
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  // Both actions revalidate the admin page server-side; usePendingAction
  // releases the button on the action response so approving several
  // requests in a row never hangs the second click.
  const onApprove = () => {
    setError(null);
    void run(async () => {
      const r = await approveSignupRequest(request.id);
      if (!r.ok) setError(r.error);
    });
  };

  const onReject = () => {
    setError(null);
    void run(async () => {
      const r = await rejectSignupRequest(request.id, rejectNote);
      if (!r.ok) setError(r.error);
      else setShowReject(false);
    });
  };

  const statusChip = (() => {
    if (request.status === "pending") {
      return (
        <Chip tone="warning">
          <Clock className="h-3.5 w-3.5" strokeWidth={2} />
          {isHebrew ? "ממתין" : "Pending"}
        </Chip>
      );
    }
    if (request.status === "approved") {
      return (
        <Chip tone="secondary">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
          {isHebrew ? "אושר" : "Approved"}
        </Chip>
      );
    }
    return (
      <Chip>
        <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
        {isHebrew ? "נדחה" : "Rejected"}
      </Chip>
    );
  })();

  return (
    <li className="bg-surface-container-lowest border border-outline-variant rounded-lg p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h3 className="font-bold text-base md:text-lg text-on-surface truncate">
            {request.displayName}
          </h3>
          <p className="text-xs text-on-surface-variant">
            {isHebrew ? "הוגש ב-" : "Submitted "}
            {formatDateTime(request.createdAt, locale, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        </div>
        {statusChip}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <a
          href={`tel:${request.phone}`}
          className="inline-flex items-center gap-2 text-on-surface hover:text-primary min-h-[44px]"
        >
          <Phone className="h-4 w-4 shrink-0 text-on-surface-variant" strokeWidth={1.75} />
          <bdi dir="ltr">{request.phone}</bdi>
        </a>
        <a
          href={`mailto:${request.email}`}
          className="inline-flex items-center gap-2 text-on-surface hover:text-primary min-h-[44px] break-all"
        >
          <Mail className="h-4 w-4 shrink-0 text-on-surface-variant" strokeWidth={1.75} />
          <bdi dir="ltr">{request.email}</bdi>
        </a>
      </div>

      {request.status !== "pending" && request.decidedAt && (
        <p className="text-xs text-on-surface-variant border-t border-outline-variant pt-2">
          {request.status === "approved"
            ? isHebrew
              ? "אושר ב-"
              : "Approved "
            : isHebrew
            ? "נדחה ב-"
            : "Rejected "}
          {formatDateTime(request.decidedAt, locale, {
            dateStyle: "short",
            timeStyle: "short",
          })}
          {request.decidedByName ? (
            <>
              {" "}
              {isHebrew ? "ע״י" : "by"} {request.decidedByName}
            </>
          ) : null}
          {request.note && (
            <>
              {" · "}
              <span className="italic">{request.note}</span>
            </>
          )}
        </p>
      )}

      {request.status === "pending" && (
        <div className="flex flex-col gap-2 pt-1">
          {error && (
            <p className="text-sm text-error">
              {isHebrew ? "שגיאה: " : "Error: "}
              {error}
            </p>
          )}
          {showReject ? (
            <div className="flex flex-col gap-2 bg-surface-container rounded-md p-3">
              <LabelCaps>
                {isHebrew ? "סיבת דחייה (לא חובה)" : "Reason (optional)"}
              </LabelCaps>
              <input
                type="text"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder={isHebrew ? "לא מכיר את המבקש..." : "Don't recognize this person..."}
                className="w-full h-12 px-3 rounded-md border border-outline bg-surface text-[16px] text-on-surface focus:outline-none focus:border-primary"
              />
              <div className="flex gap-2 flex-wrap">
                <PillButton
                  type="button"
                  variant="primary"
                  onClick={onReject}
                  disabled={pending}
                  className={clsx("flex-1 min-w-[120px]", pending && "opacity-70 cursor-wait")}
                >
                  <UserX className="h-4 w-4" strokeWidth={2} />
                  {isHebrew ? "אישור דחייה" : "Confirm reject"}
                </PillButton>
                <PillButton
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowReject(false);
                    setRejectNote("");
                  }}
                  disabled={pending}
                  className="flex-1 min-w-[120px]"
                >
                  {isHebrew ? "ביטול" : "Cancel"}
                </PillButton>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <PillButton
                type="button"
                variant="secondary"
                onClick={onApprove}
                disabled={pending}
                className={clsx("flex-1 min-w-[140px]", pending && "opacity-70 cursor-wait")}
              >
                <UserCheck className="h-4 w-4" strokeWidth={2} />
                {pending
                  ? isHebrew
                    ? "מאשר..."
                    : "Approving..."
                  : isHebrew
                  ? "אישור והזמנה"
                  : "Approve & invite"}
              </PillButton>
              <PillButton
                type="button"
                variant="ghost"
                onClick={() => setShowReject(true)}
                disabled={pending}
                className="flex-1 min-w-[120px]"
              >
                <UserX className="h-4 w-4" strokeWidth={2} />
                {isHebrew ? "דחייה" : "Reject"}
              </PillButton>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function EmptyState({ filter, isHebrew }: { filter: Filter; isHebrew: boolean }) {
  const map: Record<Filter, [string, string]> = {
    pending: ["אין בקשות ממתינות כרגע", "No pending requests"],
    approved: ["עדיין לא אושרו בקשות", "No approved requests yet"],
    rejected: ["לא נדחו בקשות", "No rejected requests"],
    all: ["עדיין לא הוגשו בקשות הרשמה", "No signup requests yet"],
  };
  const [he, en] = map[filter];
  return (
    <div className="bg-surface-container-lowest border border-dashed border-outline-variant rounded-lg p-8 text-center">
      <p className="text-on-surface-variant">{isHebrew ? he : en}</p>
    </div>
  );
}
