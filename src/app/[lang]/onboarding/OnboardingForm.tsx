"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, CircleDot, AlertCircle, ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import type { Dictionary, Locale } from "../dictionaries";
import { PillButton, LabelCaps } from "@/components/ui";
import { saveProfile, recordPayment } from "./actions";
import { localePath } from "@/lib/paths";

type PaymentStatus = "pending" | "approved" | "rejected" | null;
type PaymentMethod = "bit" | "paybox" | null;

export function OnboardingForm({
  locale,
  dict,
  initialName,
  initialPhone,
  paymentStatus,
  paymentMethod,
  payboxUrl,
}: {
  locale: Locale;
  dict: Dictionary;
  initialName: string;
  initialPhone: string;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  payboxUrl: string;
}) {
  const isHebrew = locale === "he";
  const displayFont = isHebrew
    ? "font-[family-name:var(--font-display)]"
    : "font-[family-name:var(--font-display-en)]";
  // Still used for the "go to dashboard" CTA after approval. The
  // recordPayment server action handles its own revalidation, so we
  // intentionally do NOT call router.refresh() inside the submit
  // transition — it would only delay the "Saved" state for no extra
  // correctness.
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [profileSaved, setProfileSaved] = useState(
    initialName.length >= 2 && initialPhone.length >= 7,
  );
  // Display only - Paybox is the only method now. Kept so legacy "bit"
  // payments still render their badge correctly in the status row.
  const lastMethod: PaymentMethod = paymentMethod;
  const [submittedStatus, setSubmittedStatus] = useState<PaymentStatus>(
    paymentStatus,
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recipient = "054-1234567";

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(recipient.replace(/\D/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleSaveProfile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData();
    form.set("displayName", name);
    form.set("phone", phone);
    startTransition(async () => {
      const res = await saveProfile(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setProfileSaved(true);
    });
  };

  const handleIPaid = () => {
    setError(null);
    startTransition(async () => {
      const res = await recordPayment();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSubmittedStatus("pending");
      // recordPayment already revalidates /onboarding and /pay plus
      // the access tag, so the next nav reflects the new pending row.
      // A separate router.refresh() would keep "שולח…" up for an
      // extra round trip after the row is already in the DB.
    });
  };

  const isApproved = submittedStatus === "approved";
  const isPending = submittedStatus === "pending";

  return (
    <div className="flex flex-col gap-6">
      <ProfileStep
        isHebrew={isHebrew}
        displayFont={displayFont}
        dict={dict}
        name={name}
        phone={phone}
        setName={setName}
        setPhone={setPhone}
        profileSaved={profileSaved}
        pending={pending}
        onSubmit={handleSaveProfile}
        error={error === "invalid" || error === "db" ? error : null}
      />

      <PaymentStep
        isHebrew={isHebrew}
        displayFont={displayFont}
        dict={dict}
        recipient={recipient}
        copied={copied}
        onCopy={copyNumber}
        lastMethod={lastMethod}
        profileSaved={profileSaved}
        isPending={isPending}
        isApproved={isApproved}
        onIPaid={handleIPaid}
        pending={pending}
        payboxUrl={payboxUrl}
      />

      {isApproved && (
        <PillButton
          type="button"
          onClick={() => router.push(localePath(locale))}
          className="w-full py-4 text-base"
        >
          {dict.forms.onboarding.goToDashboard}
        </PillButton>
      )}
    </div>
  );
}

function ProfileStep(props: {
  isHebrew: boolean;
  displayFont: string;
  dict: Dictionary;
  name: string;
  phone: string;
  setName: (v: string) => void;
  setPhone: (v: string) => void;
  profileSaved: boolean;
  pending: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  error: string | null;
}) {
  const { displayFont, dict, profileSaved } = props;
  return (
    <form
      onSubmit={props.onSubmit}
      className="bg-[#FBF6EB] p-5 md:p-6 rounded-lg border border-outline shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col gap-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          className={`${displayFont} text-xl md:text-2xl leading-8 font-bold`}
        >
          {dict.forms.onboarding.profileTitle}
        </h2>
        <StatusBadge
          ok={profileSaved}
          okLabel={dict.forms.onboarding.profileSavedBadge}
          pendingLabel={dict.forms.onboarding.profilePendingBadge}
        />
      </div>

      <label className="flex flex-col gap-1">
        <LabelCaps>{dict.onboarding.fullName}</LabelCaps>
        <input
          type="text"
          required
          minLength={2}
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          placeholder={dict.onboarding.fullNamePlaceholder}
          className="h-12 bg-transparent border-0 border-b border-outline focus:border-primary focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant"
        />
      </label>
      <label className="flex flex-col gap-1">
        <LabelCaps>{dict.onboarding.phone}</LabelCaps>
        <input
          type="tel"
          required
          dir="ltr"
          inputMode="tel"
          value={props.phone}
          onChange={(e) => props.setPhone(e.target.value)}
          placeholder={dict.onboarding.phonePlaceholder}
          className="h-12 bg-transparent border-0 border-b border-outline focus:border-primary focus:outline-none text-[16px] text-on-surface placeholder:text-outline-variant text-left"
        />
      </label>

      {props.error && (
        <p className="inline-flex items-center gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {dict.forms.onboarding.profileValidationError}
        </p>
      )}

      <PillButton
        type="submit"
        disabled={props.pending}
        className={clsx("w-full py-4 text-base", props.pending && "opacity-70 cursor-wait")}
      >
        {props.pending
          ? dict.forms.onboarding.profileSavingPending
          : profileSaved
            ? dict.forms.onboarding.profileUpdateCta
            : dict.forms.onboarding.profileSaveCta}
      </PillButton>
    </form>
  );
}

function PaymentStep(props: {
  isHebrew: boolean;
  displayFont: string;
  dict: Dictionary;
  recipient: string;
  copied: boolean;
  onCopy: () => void;
  lastMethod: PaymentMethod;
  profileSaved: boolean;
  isPending: boolean;
  isApproved: boolean;
  onIPaid: () => void;
  pending: boolean;
  payboxUrl: string;
}) {
  const { displayFont, dict } = props;
  const locked = !props.profileSaved || props.isApproved;
  // Legacy "bit" rows still show their original method label in the
  // status row; everything below the recipient block is Paybox only.
  const methodLabel =
    props.lastMethod === "bit"
      ? dict.onboarding.bit
      : dict.onboarding.paybox;

  return (
    <div
      className={clsx(
        "bg-[#FBF6EB] p-5 md:p-6 rounded-lg border border-outline shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col gap-6",
        locked && !props.isApproved && "opacity-60 pointer-events-none",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className={`${displayFont} text-xl md:text-2xl leading-8 font-bold`}>
          {dict.onboarding.payVia}
        </h2>
        <StatusBadge
          ok={props.isApproved}
          pending={props.isPending}
          okLabel={dict.onboarding.statusApproved}
          pendingLabel={dict.onboarding.statusPending}
          notStartedLabel={dict.forms.onboarding.paymentNotPaid}
        />
      </div>

      <p className="text-base text-on-surface-variant">
        {dict.onboarding.entryFeeLabel}:{" "}
        <span className="font-bold text-on-surface text-lg">
          <bdi>{dict.onboarding.entryFee}</bdi> {dict.common.currency}
        </span>{" "}
        <span className="text-sm">
          {dict.forms.onboarding.payViaConnector}{" "}
          <span className="font-bold text-on-surface">{methodLabel}</span>
        </span>
      </p>

      <div className="bg-surface-container-low p-4 rounded border border-outline-variant flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <LabelCaps>{dict.onboarding.recipientLabel}</LabelCaps>
          <span className="text-lg leading-7 text-on-surface bidi-ltr">
            {props.recipient}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onCopy}
          aria-label={dict.onboarding.copyNumber}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary hover:bg-surface-container rounded-full transition-colors"
        >
          {props.copied ? (
            <Check className="h-5 w-5 text-secondary" strokeWidth={2} />
          ) : (
            <Copy className="h-5 w-5" strokeWidth={1.75} />
          )}
        </button>
      </div>

      <p className="text-sm text-on-surface-variant">
        {dict.onboarding.payboxHelp}
      </p>

      <a
        href={props.payboxUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={props.isApproved || undefined}
        className={clsx(
          "press-down inline-flex items-center justify-center gap-2 w-full min-h-[48px] py-3 px-5 rounded-full border-2 border-primary bg-surface-container-lowest text-primary font-[family-name:var(--font-label)] text-[14px] font-bold tracking-[0.05em] hover:bg-primary-container transition-colors",
          props.isApproved && "opacity-60 pointer-events-none",
        )}
      >
        <ExternalLink className="h-4 w-4" strokeWidth={2.5} />
        {dict.onboarding.payboxOpen}
      </a>

      <PillButton
        type="button"
        onClick={props.onIPaid}
        disabled={props.pending || props.isApproved || props.isPending}
        className={clsx(
          "w-full py-4 text-base",
          (props.isApproved || props.isPending) && "opacity-60 cursor-not-allowed",
        )}
      >
        {props.isApproved
          ? dict.common.paid
          : props.isPending
            ? dict.onboarding.statusPending
            : dict.onboarding.iPaid}
      </PillButton>
    </div>
  );
}

function StatusBadge({
  ok,
  pending,
  okLabel,
  pendingLabel,
  notStartedLabel,
}: {
  ok: boolean;
  pending?: boolean;
  okLabel: string;
  pendingLabel: string;
  notStartedLabel?: string;
}) {
  const tone = ok ? "text-secondary" : pending ? "text-tertiary" : "text-outline";
  const label = ok ? okLabel : pending ? pendingLabel : (notStartedLabel ?? pendingLabel);
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-container-lowest border border-outline-variant">
      <CircleDot className={clsx("h-3 w-3", tone)} strokeWidth={2} />
      <LabelCaps>{label}</LabelCaps>
    </span>
  );
}
