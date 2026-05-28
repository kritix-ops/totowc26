import { notFound, redirect } from "next/navigation";
import { hasLocale, type Locale } from "../../dictionaries";
import { localePath } from "@/lib/paths";

// /admin/signup-requests was merged into /admin/users as a tab. We keep
// the route alive (rather than deleting it) because outbound emails —
// the admin new-signup notification and the recovery flow's reference
// link — point here. Preserve any ?status= filter so a deep link to
// "approved" or "rejected" still lands on the right view.
export default async function LegacySignupRequestsRedirect({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/signup-requests">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;

  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status =
    raw === "approved" || raw === "rejected" || raw === "all" || raw === "pending"
      ? raw
      : null;

  const target = status
    ? `${localePath(locale, "admin/users")}?tab=requests&status=${status}`
    : `${localePath(locale, "admin/users")}?tab=requests`;

  redirect(target);
}
