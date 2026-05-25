import { notFound, redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { getUser } from "@/lib/supabase/auth";
import { getUserAccess } from "@/lib/access";
import { getPayboxUrl } from "@/lib/paybox";
import { localePath } from "@/lib/paths";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { PayPanel } from "./PayPanel";

export default async function PayPage({
  params,
}: PageProps<"/[lang]/pay">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getUser();
  if (!user) redirect(localePath(locale, "login"));

  const [latestPayment, access, payboxUrl] = await Promise.all([
    db
      .select({
        status: payments.status,
        method: payments.method,
        submittedAt: payments.submittedAt,
      })
      .from(payments)
      .where(eq(payments.userId, user.id))
      .orderBy(desc(payments.submittedAt))
      .limit(1)
      .then((r) => r[0] ?? null),
    getUserAccess(user.id),
    getPayboxUrl(),
  ]);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-2xl mx-auto w-full">
      <PayPanel
        locale={locale}
        dict={dict}
        paymentStatus={latestPayment?.status ?? null}
        paymentMethod={latestPayment?.method ?? null}
        isAdmin={access.isAdmin}
        payboxUrl={payboxUrl}
      />
    </section>
  );
}
