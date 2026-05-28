import { eq } from "drizzle-orm";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { db } from "@/db";
import { profiles, settings } from "@/db/schema";
import { getMyRankSummary } from "@/db/queries";
import { getUserAccess } from "@/lib/access";
import { getBankBreakdown } from "@/lib/bank";
import { BankPill } from "./BankPill";
import { ProfileMenu } from "./ProfileMenu";

// Streamed section of the header that owns every per-user query. The
// AppShell renders this inside a <Suspense> boundary so the static shell
// (logo, nav, rules CTA) paints immediately on every navigation while
// these queries run in parallel and stream in behind a skeleton.
//
// Splitting this out is what makes the app feel "instant" — the shell
// stays interactive across navigations and only this small surface area
// is replaced when the per-user numbers refresh.
export async function HeaderUserSection({
  locale,
  dict,
  userId,
  userEmail,
}: {
  locale: Locale;
  dict: Dictionary;
  userId: string;
  userEmail: string | null;
}) {
  const [rankSummary, access, bank, profileRow, settingsRow] = await Promise.all([
    getMyRankSummary(userId),
    getUserAccess(userId),
    getBankBreakdown(userId),
    db
      .select({ displayName: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ whatsappGroupUrl: settings.whatsappGroupUrl })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const displayName = profileRow?.displayName ?? userEmail ?? "";
  const admin = !!access?.isAdmin;

  console.info("[header user section render]", {
    isAdmin: admin,
    myRank: rankSummary?.myRank ?? null,
    totalPlayers: rankSummary?.total ?? null,
    bankBalance: bank?.balance ?? null,
  });

  return (
    <>
      {bank && (
        <BankPill
          locale={locale}
          dict={dict}
          balance={bank.balance}
          starting={bank.starting}
        />
      )}
      {rankSummary && rankSummary.myRank > 0 ? (
        <span className="hidden md:inline-block font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] text-on-surface-variant">
          {dict.common.rankShort} <bdi>#{rankSummary.myRank}</bdi>
        </span>
      ) : null}
      <ProfileMenu
        locale={locale}
        displayName={displayName}
        isAdmin={admin}
        whatsappGroupUrl={settingsRow?.whatsappGroupUrl ?? null}
        labels={{
          profile: dict.nav.profile,
          admin: dict.nav.admin,
          rules: dict.nav.rules,
          language: dict.profile.language,
          languageOther: dict.profile.languageOther,
          logout: dict.profile.logout,
          openMenu: dict.nav.openMenu,
          whatsapp: dict.profile.whatsappMenu,
        }}
      />
    </>
  );
}
