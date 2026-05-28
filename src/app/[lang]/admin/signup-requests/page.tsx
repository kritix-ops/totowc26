import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";
import { fetchSignupRequests } from "./queries";
import { SignupRequestsList } from "./SignupRequestsList";

type FilterParam = "pending" | "approved" | "rejected" | "all";

export default async function AdminSignupRequestsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/signup-requests">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const sp = await searchParams;
  const rawFilter = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const filter: FilterParam =
    rawFilter === "approved" ||
    rawFilter === "rejected" ||
    rawFilter === "all"
      ? rawFilter
      : "pending";

  const requests = await fetchSignupRequests(filter);

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-5xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[44px] md:leading-[48px] font-bold text-primary">
          {isHebrew ? "בקשות הרשמה" : "Signup requests"}
        </h1>
        <p className="text-sm md:text-base text-on-surface-variant">
          {isHebrew
            ? "אשר או דחה בקשות שנרשמו דרך הטופס הציבורי"
            : "Approve or reject submissions from the public signup form"}
        </p>
      </header>

      <SignupRequestsList
        locale={locale}
        requests={requests}
        filter={filter}
      />
    </section>
  );
}
