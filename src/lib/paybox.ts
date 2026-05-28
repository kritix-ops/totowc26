// Client-safe Paybox constants. Anything that needs to read the
// admin-controlled URL out of the database lives in `paybox-server.ts`
// behind a `server-only` boundary - importing this file is fine from
// either a Client Component or a Server Component.

// Hard-coded fallback so the "Open Paybox" button is never dead. The
// admin overrides this with the real Paybox group URL via the admin
// settings UI; the override value lives in `settings.paybox_url` and is
// fetched server-side via `getPayboxUrl`.
export const PAYBOX_FALLBACK_URL = "https://www.payboxapp.com/";

export const ENTRY_FEE_ILS = 120;
