"use client";

import Link from "next/link";
import { UserPlus, ChevronLeft, ChevronRight } from "lucide-react";
import type { Locale } from "../../dictionaries";
import { LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { RequestCard } from "../signup-requests/SignupRequestsList";
import type { SignupRequestRow } from "../signup-requests/queries";

// Standing surface for pending signup_requests rows on /admin/users so an
// admin who lands on the "user management" page after the email
// notification still sees the new applicants without having to remember
// the dedicated /admin/signup-requests URL. Renders nothing when the
// queue is empty - the banner is purely action-driven.
export function PendingSignupBanner({
  requests,
  locale,
}: {
  requests: SignupRequestRow[];
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  if (requests.length === 0) return null;
  const ChevronEnd = isHebrew ? ChevronLeft : ChevronRight;

  return (
    <section
      className="rounded-lg border-2 border-tertiary bg-tertiary-fixed/40 p-4 md:p-5 flex flex-col gap-4"
      aria-labelledby="pending-signup-banner-title"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-tertiary text-on-tertiary flex items-center justify-center shrink-0">
            <UserPlus className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="flex flex-col min-w-0">
            <LabelCaps>
              {isHebrew ? "פעולה נדרשת" : "Action needed"}
            </LabelCaps>
            <h2
              id="pending-signup-banner-title"
              className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-tertiary-fixed-variant"
            >
              {isHebrew
                ? `${requests.length} ${
                    requests.length === 1
                      ? "בקשת הרשמה חדשה"
                      : "בקשות הרשמה חדשות"
                  }`
                : `${requests.length} new signup request${requests.length === 1 ? "" : "s"}`}
            </h2>
            <p className="text-sm text-on-surface-variant mt-1">
              {isHebrew
                ? "אשר או דחה כדי לצרף לקבוצה"
                : "Approve or reject to add them to the pool"}
            </p>
          </div>
        </div>
        <Link
          href={localePath(locale, "admin/signup-requests")}
          className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:text-primary/80 self-start min-h-[44px] px-2"
        >
          {isHebrew ? "פתח עמוד מלא" : "Open full page"}
          <ChevronEnd className="h-4 w-4" />
        </Link>
      </header>

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
    </section>
  );
}
