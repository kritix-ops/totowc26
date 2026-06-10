import "server-only";
import { sql } from "drizzle-orm";

// Canonical definition of "the pot" and "who has paid".
//
// A user can end up with more than one payment row (e.g. a real Paybox
// submission that an admin approves, plus a "mark paid manually" row on
// top). Summing every approved row therefore double-counts and inflates
// the pot — and because the prize split runs off the pot, it inflates the
// advertised prizes too. Every surface that shows pot money must go
// through these fragments so the number is computed one way.
//
// The rule: collapse each user to their CURRENT payment (the latest by
// submitted_at) and only count it when that current row is approved. This
// is robust to duplicate approved rows (picks one), to a later
// pending/rejected row supplanting an earlier approval (excludes the
// user), and to off-fee amounts (uses the actual recorded amount).

// Latest payment row per user. Compose into a larger query as a CTE source.
const latestPaymentPerUser = sql`
  select distinct on (user_id) user_id, status, amount_ils
  from public.payments
  order by user_id, submitted_at desc
`;

// Money in the pot: sum of each paid user's current approved amount. int scalar.
export const approvedPotIlsSql = sql`(
  select coalesce(sum(amount_ils), 0)::int
  from (${latestPaymentPerUser}) latest
  where status = 'approved'
)`;

// Participants who have paid: users whose current payment is approved. int scalar.
export const paidParticipantsSql = sql`(
  select count(*)::int
  from (${latestPaymentPerUser}) latest
  where status = 'approved'
)`;
