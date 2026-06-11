"use client";

import { useFormStatus } from "react-dom";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";

// Submit button for /auth/confirm. Lives in a Client Component only so we
// can read useFormStatus().pending and disable the button + show a "..."
// label while verifyOtp is in flight. The form itself stays in the
// server-rendered page so the action wires up without an extra round-trip.
export function ConfirmSubmitButton({
  locale,
  type,
}: {
  locale: Locale;
  type: string;
}) {
  const { pending } = useFormStatus();
  const isHebrew = locale === "he";

  const idle =
    type === "recovery"
      ? isHebrew
        ? "המשך לאיפוס סיסמה"
        : "Continue to reset password"
      : isHebrew
        ? "המשך לטוטו"
        : "Continue to Toto";

  const busy = isHebrew ? "מאמת..." : "Verifying...";

  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx(
        "press-down min-h-[52px] w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary text-on-primary text-base font-bold px-6 py-3 transition-colors",
        pending && "opacity-70 cursor-wait",
      )}
    >
      {pending ? busy : idle}
    </button>
  );
}
