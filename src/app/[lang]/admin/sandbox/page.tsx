import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";
import { isSandbox } from "@/lib/env";
import { loadSettingsDiff } from "./diff-helpers";
import { compareBranches, readGithubEnv } from "./github";
import { SandboxPanel, type GitCompareSummary } from "./SandboxPanel";

// Admin-only landing for the four "sandbox ↔ production" controls. The
// whole page hard-404s on production - the env-var guard is the
// load-bearing check, the server actions repeat it for defense in depth.
export default async function AdminSandboxPage({
  params,
}: PageProps<"/[lang]/admin/sandbox">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  if (!isSandbox()) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [settingsDiff, gitCompare] = await Promise.all([
    loadSettingsDiff().catch((err) => {
      console.error("[admin sandbox page] settings diff failed:", err);
      return null;
    }),
    loadBranchCompare().catch((err) => {
      console.error("[admin sandbox page] branch compare failed:", err);
      return null;
    }),
  ]);

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full pb-24 md:pb-10">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start min-h-[44px]"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {isHebrew ? "סאנדבוקס ↔ פרודקשן" : "Sandbox ↔ production"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "ארבע פעולות לקשר בין הסאנדבוקס לפרודקשן: לדחוף הגדרות, לדחוף קוד, למשוך קוד מהפרוד, ולשאוב נתונים מהפרוד."
            : "Four actions that bridge sandbox and production: push settings, push code, pull code from prod, and refresh data from prod."}
        </p>
      </header>

      <SandboxPanel
        locale={locale}
        settingsDiff={
          settingsDiff
            ? settingsDiff.diff.map((d) => ({
                column: d.column,
                sandbox: stringify(d.sandboxValue),
                prod: stringify(d.prodValue),
              }))
            : null
        }
        gitCompare={gitCompare}
      />
    </section>
  );
}

// One compare API call gives us aheadBy + behindBy + the commits sandbox
// has but master doesn't (the push candidates). For the pull candidates
// we need the mirror call (base=sandbox, head=master) so the commits
// list contains what master has that sandbox doesn't.
async function loadBranchCompare(): Promise<GitCompareSummary | null> {
  try {
    const env = readGithubEnv();
    const [pushCompare, pullCompare] = await Promise.all([
      compareBranches(env, "master", "sandbox"),
      compareBranches(env, "sandbox", "master"),
    ]);
    return {
      aheadBy: pushCompare.aheadBy,
      behindBy: pushCompare.behindBy,
      pushCommits: pushCompare.commits.slice(-20),
      pullCommits: pullCompare.commits.slice(-20),
    };
  } catch (err) {
    console.error("[admin sandbox page] github compare failed:", err);
    return null;
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
