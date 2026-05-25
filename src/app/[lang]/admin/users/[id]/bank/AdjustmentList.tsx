import { Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "../../../../dictionaries";
import type { AdminAdjustmentRow } from "../../queries";

export function AdjustmentList({
  rows,
  locale,
}: {
  rows: AdminAdjustmentRow[];
  locale: Locale;
}) {
  const isHebrew = locale === "he";

  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center text-on-surface-variant">
        {isHebrew ? "אין התאמות עדיין" : "No adjustments yet"}
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const positive = r.delta > 0;
        return (
          <li
            key={r.id}
            className="p-3 md:p-4 rounded-lg bg-surface-container-lowest border border-outline-variant flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={`font-[family-name:var(--font-score)] text-xl md:text-2xl font-bold tabular-nums ${
                  positive ? "text-secondary" : "text-error"
                }`}
              >
                <bdi>
                  {positive ? "+" : ""}
                  {r.delta}
                </bdi>
              </span>
              <span className="text-[11px] text-outline">
                {formatDateTime(r.createdAt, locale, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="text-sm text-on-surface whitespace-pre-wrap break-words">
              {r.reason}
            </p>
            <p className="text-[11px] text-on-surface-variant">
              {isHebrew ? "ע״י" : "By"} {r.createdByName}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
