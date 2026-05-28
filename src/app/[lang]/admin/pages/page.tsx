import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft, ChevronRight, EyeOff } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { localePath } from "@/lib/paths";
import { HIDEABLE_PAGE_KEYS } from "@/lib/page-visibility";
import { PageVisibilityForm } from "./PageVisibilityForm";

export default async function AdminPagesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [row] = await db
    .select({ hiddenPages: settings.hiddenPages })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  // Defensive cast - the column is jsonb so the runtime could return
  // any shape if a hand-crafted UPDATE landed; we filter to the known
  // catalog before handing to the client form.
  const rawHidden = Array.isArray(row?.hiddenPages)
    ? (row.hiddenPages as unknown[])
    : [];
  const hidden = rawHidden.filter(
    (k): k is string =>
      typeof k === "string" &&
      (HIDEABLE_PAGE_KEYS as readonly string[]).includes(k),
  );

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <EyeOff className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "זמינות עמודים" : "Page visibility"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "מסתיר עמודים מהמשתתפים. עמוד מוסתר לא נגיש דרך הניווט וגם לא דרך כתובת ישירה - גישה אליו מנותבת לעמוד הבית עם הודעה."
            : "Hide pages from players. A hidden page disappears from navigation and is unreachable via direct URL — visits are redirected to home with a toast."}
        </p>
      </header>

      <PageVisibilityForm locale={locale} initialHidden={hidden} />
    </section>
  );
}
