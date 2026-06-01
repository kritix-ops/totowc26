import "server-only";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { execFirstRow, sql } from "@/db/helpers";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  ALL_CUSTOM_SCOPES,
  listFillableCustomBets,
  listFillableMatches,
} from "@/lib/bets/fillable";
import { randomCustomAnswer, randomMatchScore } from "@/lib/random-picks";
import {
  writeCustomPicksBulk,
  writeMatchPick,
  type CustomPickInput,
  type WritePrincipal,
} from "@/lib/bets/write-core";

const MONKEY_DISPLAY_NAME = "הקוף";

// The monkey bot's fill pass. Driven by /api/cron/monkey (GitHub Actions,
// hourly). Sweeps EVERY open bet the monkey has not picked yet and fills an
// odds-weighted random guess, through the `bot`-principal write-core so the
// deadline/status/never-overwrite invariants and DB idempotency all hold. Two
// concurrent cron runs (GitHub can overlap) are safe: the per-user advisory
// lock serialises the custom-bet batch and the match upsert is
// onConflictDoNothing. See _plans/2026-06-01-monkey-bot-and-random-fill.md.

export type MonkeyFillReport = {
  ok: boolean;
  reason?: "no_monkey";
  matchesFilled: number;
  matchesSkipped: number;
  customFilled: number;
  customSkipped: number;
};

// The monkey is the oldest profile flagged is_bot. We support at most one for
// now; a future persona roster (see plan, "deferred") would iterate instead.
export async function getMonkeyUserId(): Promise<string | null> {
  const row = await execFirstRow<{ id: string }>(sql`
    select id::text as "id"
    from public.profiles
    where is_bot = true
    order by created_at asc
    limit 1
  `);
  return row?.id ?? null;
}

// Return the monkey's user id, self-provisioning it on first run if absent.
// profiles.id is a hard FK to auth.users, so we create the Supabase auth user
// (service-role, server-only) and let the on_auth_user_created trigger
// materialise the profile, then flag is_bot. Only the cron calls this; the
// leaderboard's read-only lookup never provisions. Returns null if the deploy
// lacks the service-role env or auth creation fails.
async function ensureMonkeyUserId(): Promise<string | null> {
  const existing = await getMonkeyUserId();
  if (existing) return existing;

  const email = (process.env.MONKEY_EMAIL ?? "monkey@toto.local").toLowerCase();
  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    console.error("[monkey] cannot self-provision: missing service-role env", err);
    return null;
  }

  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: MONKEY_DISPLAY_NAME },
  });
  if (created.error) {
    const msg = created.error.message.toLowerCase();
    // Adopt an existing auth user if the email is already taken.
    if (msg.includes("already") || msg.includes("exist") || msg.includes("registered")) {
      userId = (await findAuthUserByEmail(admin, email))?.id ?? null;
    } else {
      console.error("[monkey] createUser failed", created.error);
      return null;
    }
  } else {
    userId = created.data.user?.id ?? null;
  }
  if (!userId) {
    console.error("[monkey] provisioning produced no user id");
    return null;
  }

  // The trigger inserts the profile on auth-user creation; upsert guards the
  // race and flags is_bot either way.
  await db
    .insert(profiles)
    .values({
      id: userId,
      displayName: MONKEY_DISPLAY_NAME,
      phone: "",
      role: "player",
      isBot: true,
    })
    .onConflictDoUpdate({
      target: profiles.id,
      set: { isBot: true, displayName: MONKEY_DISPLAY_NAME },
    });

  console.info("[monkey] self-provisioned", { userId, email });
  return userId;
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof getSupabaseAdmin>,
  emailLc: string,
) {
  let page = 1;
  // Bounded scan; the pool is small (friends-group scale).
  for (let i = 0; i < 50; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error("[monkey] listUsers failed", error);
      return null;
    }
    const hit = data.users.find((u) => u.email?.toLowerCase() === emailLc);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
  return null;
}

export async function fillMonkeyPicks(): Promise<MonkeyFillReport> {
  const userId = await ensureMonkeyUserId();
  if (!userId) {
    return {
      ok: false,
      reason: "no_monkey",
      matchesFilled: 0,
      matchesSkipped: 0,
      customFilled: 0,
      customSkipped: 0,
    };
  }
  const principal: WritePrincipal = { kind: "bot", userId };

  // Match scores (1/X/2). One upsert each; onConflictDoNothing makes reruns
  // no-ops.
  let matchesFilled = 0;
  let matchesSkipped = 0;
  const matches = await listFillableMatches(userId);
  for (const m of matches) {
    const score = randomMatchScore();
    const res = await writeMatchPick(
      principal,
      { matchId: m.matchId, home: score.home, away: score.away },
      { overwrite: false },
    );
    if (res.status === "filled") matchesFilled++;
    else matchesSkipped++;
  }

  // Custom bets across every scope, in one advisory-locked batch.
  let customFilled = 0;
  let customSkipped = 0;
  const bets = await listFillableCustomBets(userId, ALL_CUSTOM_SCOPES);
  const items: CustomPickInput[] = [];
  for (const b of bets) {
    const answer = randomCustomAnswer(b.answerType, b.answerConfig);
    if (answer) items.push({ customBetId: b.id, answer });
    else customSkipped++; // free_text / unbounded number
  }
  const results = await writeCustomPicksBulk(principal, items, {
    overwrite: false,
  });
  for (const r of results) {
    if (r.status === "filled") customFilled++;
    else customSkipped++;
  }

  return {
    ok: true,
    matchesFilled,
    matchesSkipped,
    customFilled,
    customSkipped,
  };
}
