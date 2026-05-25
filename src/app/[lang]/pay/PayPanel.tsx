"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Check,
  CircleDot,
  AlertCircle,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { clsx } from "clsx";
import type { Dictionary, Locale } from "../dictionaries";
import { Card, LabelCaps, PillButton, SectionHeading } from "@/components/ui";
import { recordPayment } from "../onboarding/actions";
import { ENTRY_FEE_ILS } from "@/lib/paybox";

type PaymentStatus = "pending" | "approved" | "rejected" | null;
type PaymentMethod = "bit" | "paybox" | null;

// Universal payment surface. Every signed-in user has access to /pay so
// they can re-open the Paybox group link, see their current status, and
// mark "I paid". Admin sees an info card instead — they bypass the gate
// so they have nothing to pay.
export function PayPanel({
  locale,
  dict,
  paymentStatus,
  paymentMethod,
  isAdmin,
  payboxUrl,
}: {
  locale: Locale;
  dict: Dictionary;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  isAdmin: boolean;
  payboxUrl: string;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus>(paymentStatus);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isApproved = status === "approved";
  const isPending = status === "pending";
  const isRejected = status === "rejected";

  const handleIPaid = () => {
    setError(null);
    startTransition(async () => {
      const res = await recordPayment();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStatus("pending");
      router.refresh();
    });
  };

  if (isAdmin) {
    return (
      <Card className="p-6 flex items-start gap-3 bg-secondary-container/40">
        <ShieldCheck
          className="h-6 w-6 text-secondary shrink-0 mt-0.5"
          strokeWidth={1.75}
        />
        <div className="flex flex-col gap-1">
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "מנהל" : "Admin"}
          </SectionHeading>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "אתה מנהל הטוטו — אין צורך לשלם דמי השתתפות."
              : "You run the pool — no entry fee required."}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {dict.pay.title}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {dict.pay.subtitle}
        </p>
      </header>

      <StatusBanner
        isApproved={isApproved}
        isPending={isPending}
        isRejected={isRejected}
        dict={dict}
        paymentMethod={paymentMethod}
        isHebrew={isHebrew}
      />

      <Card className="p-5 md:p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Wallet
              className="h-6 w-6 text-primary shrink-0"
              strokeWidth={1.75}
            />
            <div className="flex flex-col gap-0.5 min-w-0">
              <LabelCaps>{dict.pay.amountLabel}</LabelCaps>
              <span className="font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold text-on-surface">
                <bdi>{ENTRY_FEE_ILS}</bdi>{" "}
                <span className="text-base text-on-surface-variant">
                  {dict.common.currency}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <LabelCaps>{dict.pay.groupLabel}</LabelCaps>
          <a
            href={payboxUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={isApproved || undefined}
            className={clsx(
              "press-down inline-flex items-center justify-center gap-2 w-full min-h-[52px] py-3 px-5 rounded-full border-2 border-primary bg-surface-container-lowest text-primary font-[family-name:var(--font-label)] text-[14px] font-bold tracking-[0.05em] hover:bg-primary-container transition-colors",
              isApproved && "opacity-60 pointer-events-none",
            )}
          >
            <ExternalLink className="h-5 w-5" strokeWidth={2.5} />
            {dict.pay.openGroup}
          </a>
          <p className="text-xs text-on-surface-variant">
            {dict.pay.afterPayHint}
          </p>
        </div>

        {error && (
          <p className="inline-flex items-center gap-2 text-sm text-error">
            <AlertCircle className="h-4 w-4" strokeWidth={2} />
            {isHebrew ? "שגיאת שמירה" : "Save failed"}
          </p>
        )}

        <PillButton
          type="button"
          onClick={handleIPaid}
          disabled={pending || isApproved || isPending}
          className={clsx(
            "w-full py-4 text-base",
            (isApproved || isPending) && "opacity-60 cursor-not-allowed",
          )}
        >
          {pending ? (
            <>{isHebrew ? "שומר..." : "Saving..."}</>
          ) : isApproved ? (
            <>
              <Check className="h-5 w-5" strokeWidth={2.5} />
              {dict.common.paid}
            </>
          ) : isPending ? (
            dict.onboarding.statusPending
          ) : (
            dict.pay.iPaid
          )}
        </PillButton>
      </Card>
    </>
  );
}

function StatusBanner({
  isApproved,
  isPending,
  isRejected,
  dict,
  paymentMethod,
  isHebrew,
}: {
  isApproved: boolean;
  isPending: boolean;
  isRejected: boolean;
  dict: Dictionary;
  paymentMethod: PaymentMethod;
  isHebrew: boolean;
}) {
  const tone = isApproved
    ? "border-secondary bg-secondary-container/40 text-on-secondary-container"
    : isPending
      ? "border-tertiary bg-tertiary-fixed/40"
      : isRejected
        ? "border-error bg-error-container text-on-error-container"
        : "border-outline-variant bg-surface-container-low";
  const dotTone = isApproved
    ? "text-secondary"
    : isPending
      ? "text-tertiary"
      : isRejected
        ? "text-error"
        : "text-outline";
  const label = isApproved
    ? dict.pay.statusPaid
    : isPending
      ? dict.pay.statusPending
      : isRejected
        ? dict.pay.statusRejected
        : dict.pay.statusNotPaid;
  const methodLabel =
    paymentMethod === "bit"
      ? dict.onboarding.bit
      : paymentMethod === "paybox"
        ? dict.onboarding.paybox
        : null;

  return (
    <div
      role="status"
      className={clsx(
        "flex items-start gap-3 p-4 md:p-5 rounded-lg border",
        tone,
      )}
    >
      <CircleDot
        className={clsx("h-5 w-5 mt-0.5 shrink-0", dotTone)}
        strokeWidth={2}
        aria-hidden
      />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="font-[family-name:var(--font-display)] text-base md:text-lg font-bold leading-tight">
          {label}
        </span>
        {methodLabel && (isPending || isRejected) && (
          <span className="text-xs text-on-surface-variant">
            {dict.pay.previousMethod}{" "}
            <span className="font-bold">{methodLabel}</span>
          </span>
        )}
        {!isApproved && !isPending && !isRejected && (
          <span className="text-xs text-on-surface-variant">
            {isHebrew
              ? "השתמש בכפתור למטה כדי לפתוח את קבוצת ה-Paybox."
              : "Use the button below to open the Paybox group."}
          </span>
        )}
      </div>
    </div>
  );
}
