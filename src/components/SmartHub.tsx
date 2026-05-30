import { Sparkles, CheckCircle2 } from "lucide-react";
import { buildSmartHub } from "@/lib/moments";
import type { Locale } from "@/app/[lang]/dictionaries";
import { Card, SectionHeading } from "@/components/ui";
import { SmartHubRow } from "./SmartHubRow";

// Dashboard "Up next" card. Lists the top N actionable moments for
// the signed-in user. Sits between StatusRow and UpcomingSection in
// page.tsx, inside its own <Suspense> so the rest of the dashboard
// paints without waiting on the moment engine's fan-out.
//
// Returns null when the user has disabled the hub in their settings,
// so the Suspense boundary collapses to nothing in that case.
//
// See _plans/2026-05-30-smart-reminders.md §3.1.

type Props = {
  userId: string;
  locale: Locale;
};

export async function SmartHubAsync({ userId, locale }: Props) {
  const result = await buildSmartHub({ userId, locale });
  if (!result.enabled) return null;

  const isHebrew = locale === "he";
  const dismissLabel = isHebrew ? "התעלם עד מחר" : "Dismiss until tomorrow";

  return (
    <section
      aria-labelledby="smart-hub-heading"
      className="flex flex-col gap-4 md:gap-6"
    >
      <div className="flex items-end justify-between gap-3">
        <SectionHeading as="h3">
          <span
            id="smart-hub-heading"
            className="inline-flex items-center gap-2"
          >
            <Sparkles
              className="h-5 w-5 text-tertiary-fixed-dim"
              strokeWidth={1.75}
              aria-hidden
            />
            {isHebrew ? "מה עכשיו" : "Up next"}
          </span>
        </SectionHeading>
      </div>

      {result.moments.length === 0 ? (
        <Card className="p-5 md:p-6 flex items-center gap-3 text-on-surface-variant">
          <CheckCircle2
            className="h-5 w-5 text-secondary shrink-0"
            strokeWidth={1.75}
            aria-hidden
          />
          <p className="text-sm md:text-base leading-snug">
            {isHebrew
              ? "הכל מסודר. נחזור לכאן ברגע שתופיע פעולה רלוונטית."
              : "All caught up. We'll be back when something needs you."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2 md:gap-3">
          {result.moments.map((m, idx) => (
            <li key={m.key}>
              <SmartHubRow
                momentKey={m.key}
                type={m.type}
                urgency={m.urgency}
                icon={m.icon}
                title={m.title}
                body={m.body}
                ctaLabel={m.ctaLabel}
                ctaHref={m.ctaHref}
                dismissLabel={dismissLabel}
                index={idx}
                isHebrew={isHebrew}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SmartHubSkeleton() {
  return (
    <section className="flex flex-col gap-4 md:gap-6" aria-hidden>
      <div className="h-7 w-32 rounded animate-pulse bg-surface-container-high" />
      <div className="flex flex-col gap-2 md:gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-lg animate-pulse bg-surface-container-high border border-outline-variant"
          />
        ))}
      </div>
    </section>
  );
}
