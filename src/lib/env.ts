// Which deployment of the app we're running inside.
// Driven entirely by NEXT_PUBLIC_TOTO_ENV, set per Vercel project:
//   - sandbox project sets it to "sandbox"
//   - production project leaves it unset (defaults to "production")
// Every sandbox-only surface (banner, /admin/sandbox page, the three
// push-to-prod server actions) reads through isSandbox() so a single
// missing env var can never accidentally enable sandbox behavior on
// production.
export type TotoEnv = "production" | "sandbox";

export function totoEnv(): TotoEnv {
  return process.env.NEXT_PUBLIC_TOTO_ENV === "sandbox"
    ? "sandbox"
    : "production";
}

export function isSandbox(): boolean {
  return totoEnv() === "sandbox";
}

export function isProduction(): boolean {
  return totoEnv() === "production";
}
