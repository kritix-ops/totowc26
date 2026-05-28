// Pulls every push_subscriptions row for the given email and sends a
// test notification to each. Bypasses the Next.js auth layer so the
// admin can fire pushes from a terminal during prod debugging.
import postgres from "postgres";
import webpush from "web-push";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/push-now.mjs <email>");
  process.exit(1);
}

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing.");
  process.exit(1);
}
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT ?? "mailto:yoav@kritix.io",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });
try {
  const subs = await sql`
    select
      ps.id::text                          as id,
      ps.endpoint                          as endpoint,
      ps.p256dh                            as p256dh,
      ps.auth                              as auth,
      substring(ps.user_agent from 1 for 60) as ua
    from public.push_subscriptions ps
    join auth.users au on au.id = ps.user_id
    where lower(au.email) = lower(${email})
  `;
  console.log("FOUND SUBSCRIPTIONS:", subs.length);
  if (subs.length === 0) {
    console.log("Nothing to send to.");
    process.exit(0);
  }
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    const host = s.endpoint.match(/https?:\/\/([^/]+)/)?.[1] ?? "?";
    process.stdout.write(`→ ${host}  ua="${s.ua}" ... `);
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({
          title: "טוטו מונדיאל — בדיקת push",
          body: "אם רואים את זה במכשיר, הצינור עובד.",
          url: "/he",
          tag: "manual-push-test",
        }),
        { TTL: 60 * 60 },
      );
      sent += 1;
      console.log("OK");
    } catch (err) {
      failed += 1;
      const status = err?.statusCode ?? "?";
      const msg = err?.body?.slice?.(0, 200) ?? err?.message ?? String(err);
      console.log(`FAIL status=${status} body=${msg}`);
    }
  }
  console.log(`DONE: sent=${sent} failed=${failed} attempted=${subs.length}`);
} finally {
  await sql.end();
}
