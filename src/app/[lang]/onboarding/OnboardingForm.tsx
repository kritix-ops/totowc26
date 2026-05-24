"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, CircleDot, AlertCircle } from "lucide-react";
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
}: {
  locale: Locale;
  dict: Dictionary;
  initialName: string;
  initialPhone: string;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
}) {
  const isHebrew = locale === "he";
  const displayFont = isHebrew
    ? "font-[family-name:var(--font-display)]"
    : "font-[family-name:var(--font-display-en)]";
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [profileSaved, setProfileSaved] = useState(
    initialName.length >= 2 && initialPhone.length >= 7,
  );
  const [method, setMethod] = useState<PaymentMethod>(paymentMethod);
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
    if (!method) return;
    setError(null);
    startTransition(async () => {
      const res = await recordPayment(method);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSubmittedStatus("pending");
      // Refresh so server-side checks rerun.
      router.refresh();
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
        method={method}
        setMethod={setMethod}
        profileSaved={profileSaved}
        isPending={isPending}
        isApproved={isApproved}
        onIPaid={handleIPaid}
        pending={pending}
      />

      {isApproved && (
        <PillButton
          type="button"
          onClick={() => router.push(localePath(locale, "dashboard"))}
          className="w-full py-4 text-base"
        >
          {isHebrew ? "מעבר לדאשבורד" : "Go to dashboard"}
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
  const { isHebrew, displayFont, dict, profileSaved } = props;
  return (
    <form
      onSubmit={props.onSubmit}
      className="bg-[#FBF6EB] p-5 md:p-6 rounded-lg border border-outline shadow-[0_8px_24px_rgba(28,20,15,0.08)] flex flex-col gap-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          className={`${displayFont} text-xl md:text-2xl leading-8 font-bold`}
        >
          {isHebrew ? "פרטים אישיים" : "Your details"}
        </h2>
        <StatusBadge
          ok={profileSaved}
          okLabel={isHebrew ? "נשמר" : "Saved"}
          pendingLabel={isHebrew ? "ממתין" : "Pending"}
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
          {isHebrew
            ? "שם חייב לפחות 2 תווים וטלפון לפחות 7 ספרות"
            : "Name needs 2+ chars, phone needs 7+ digits"}
        </p>
      )}

      <PillButton
        type="submit"
        disabled={props.pending}
        className={clsx("w-full py-4 text-base", props.pending && "opacity-70 cursor-wait")}
      >
        {props.pending
          ? isHebrew ? "שומר..." : "Saving..."
          : profileSaved
            ? isHebrew ? "עדכן" : "Update"
            : isHebrew ? "שמור פרטים" : "Save details"}
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
  method: PaymentMethod;
  setMethod: (m: PaymentMethod) => void;
  profileSaved: boolean;
  isPending: boolean;
  isApproved: boolean;
  onIPaid: () => void;
  pending: boolean;
}) {
  const { isHebrew, displayFont, dict } = props;
  const locked = !props.profileSaved || props.isApproved;

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
          notStartedLabel={isHebrew ? "טרם שולם" : "Not paid"}
        />
      </div>

      <p className="text-base text-on-surface-variant">
        {dict.onboarding.entryFeeLabel}:{" "}
        <span className="font-bold text-on-surface text-lg">
          <bdi>{dict.onboarding.entryFee}</bdi> {dict.common.currency}
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

      <div className="grid grid-cols-2 gap-3">
        {(["bit", "paybox"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => props.setMethod(m)}
            disabled={props.isApproved}
            className={clsx(
              "press-down min-h-[48px] border rounded-full px-4 py-3 font-bold text-base flex items-center justify-center gap-2 transition-colors",
              props.method === m
                ? "bg-surface-container-high border-primary text-primary"
                : "bg-surface-container-lowest border-outline text-on-surface hover:bg-surface-container-low",
            )}
          >
            {m === "bit" ? dict.onboarding.bit : dict.onboarding.paybox}
          </button>
        ))}
      </div>

      <PillButton
        type="button"
        onClick={props.onIPaid}
        disabled={!props.method || props.pending || props.isApproved || props.isPending}
        className={clsx(
          "w-full py-4 text-base",
          (!props.method || props.isApproved || props.isPending) &&
            "opacity-60 cursor-not-allowed",
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
