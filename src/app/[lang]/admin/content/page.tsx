import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { listAllOverrides } from "@/lib/content-overrides";
import { localePath } from "@/lib/paths";
import {
  getDefaultDictionary,
  hasLocale,
  type Locale,
} from "../../dictionaries";
import { ContentEditor, type ContentEntry } from "./ContentEditor";

// Walks a nested dictionary object (only 2 levels deep in practice) and
// emits flat dotted-path leaves. Skips non-string leaves so future
// numeric/boolean dictionary entries don't crash the editor.
function flattenDict(
  node: unknown,
  prefix: string,
  out: Array<{ key: string; value: string }>,
): void {
  if (typeof node === "string") {
    out.push({ key: prefix, value: node });
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    flattenDict(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

export default async function AdminContentPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  await requireAdmin(locale);
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [heDefault, enDefault, overrides] = await Promise.all([
    getDefaultDictionary("he"),
    getDefaultDictionary("en"),
    listAllOverrides(),
  ]);

  const heLeaves: Array<{ key: string; value: string }> = [];
  const enLeaves: Array<{ key: string; value: string }> = [];
  flattenDict(heDefault, "", heLeaves);
  flattenDict(enDefault, "", enLeaves);

  // Build the joined map keyed by dotted path. Either locale missing
  // the key would mean the JSONs drifted - we surface the row regardless
  // so the admin can spot it.
  const byKey = new Map<
    string,
    {
      key: string;
      section: string;
      shortKey: string;
      defaultHe: string;
      defaultEn: string;
    }
  >();
  for (const leaf of heLeaves) {
    const dot = leaf.key.indexOf(".");
    byKey.set(leaf.key, {
      key: leaf.key,
      section: dot === -1 ? leaf.key : leaf.key.slice(0, dot),
      shortKey: dot === -1 ? leaf.key : leaf.key.slice(dot + 1),
      defaultHe: leaf.value,
      defaultEn: "",
    });
  }
  for (const leaf of enLeaves) {
    const existing = byKey.get(leaf.key);
    if (existing) {
      existing.defaultEn = leaf.value;
    } else {
      const dot = leaf.key.indexOf(".");
      byKey.set(leaf.key, {
        key: leaf.key,
        section: dot === -1 ? leaf.key : leaf.key.slice(0, dot),
        shortKey: dot === -1 ? leaf.key : leaf.key.slice(dot + 1),
        defaultHe: "",
        defaultEn: leaf.value,
      });
    }
  }

  const overridesByKey = new Map<string, { he: string | null; en: string | null }>();
  for (const o of overrides) {
    const slot = overridesByKey.get(o.key) ?? { he: null, en: null };
    if (o.locale === "he") slot.he = o.value;
    if (o.locale === "en") slot.en = o.value;
    overridesByKey.set(o.key, slot);
  }

  const entries: ContentEntry[] = Array.from(byKey.values()).map((row) => {
    const ov = overridesByKey.get(row.key);
    return {
      key: row.key,
      section: row.section,
      shortKey: row.shortKey,
      defaultHe: row.defaultHe,
      defaultEn: row.defaultEn,
      overrideHe: ov?.he ?? null,
      overrideEn: ov?.en ?? null,
    };
  });

  // Stable ordering: by section first (preserves JSON section order),
  // then by appearance within the section.
  const sectionOrder = new Map<string, number>();
  for (const leaf of heLeaves) {
    const dot = leaf.key.indexOf(".");
    const section = dot === -1 ? leaf.key : leaf.key.slice(0, dot);
    if (!sectionOrder.has(section)) sectionOrder.set(section, sectionOrder.size);
  }
  entries.sort((a, b) => {
    const sa = sectionOrder.get(a.section) ?? 999;
    const sb = sectionOrder.get(b.section) ?? 999;
    if (sa !== sb) return sa - sb;
    return a.key.localeCompare(b.key);
  });

  const overriddenCount = entries.filter(
    (e) => e.overrideHe !== null || e.overrideEn !== null,
  ).length;

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary">
          {isHebrew ? "עריכת תוכן" : "Content editor"}
        </h1>
        <p className="text-sm text-on-surface-variant max-w-prose">
          {isHebrew
            ? "כל טקסט שמופיע באפליקציה - עברית ואנגלית. עורכים, שומרים, ועדכון תופס לכל המשתמשים תוך שניות. ערך ריק או 'איפוס לברירת מחדל' מחזיר את המחרוזת המקורית מהקוד."
            : "Every string the app shows users - Hebrew and English. Edit, save, change is live for everyone within seconds. Reset clears the override and falls back to the JSON default in the repo."}
        </p>
        <Card className="px-4 py-3 text-sm text-on-surface-variant flex flex-wrap items-center gap-x-4 gap-y-1 self-start">
          <span>
            <strong className="text-on-surface">{entries.length}</strong>{" "}
            {isHebrew ? "מפתחות" : "keys"}
          </span>
          <span>
            <strong className="text-on-surface">{overriddenCount}</strong>{" "}
            {isHebrew ? "ערוכים" : "overridden"}
          </span>
          <span>
            <strong className="text-on-surface">{sectionOrder.size}</strong>{" "}
            {isHebrew ? "סקציות" : "sections"}
          </span>
        </Card>
      </header>

      <ContentEditor locale={locale} entries={entries} />
    </section>
  );
}
