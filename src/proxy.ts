import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const LOCALES = ["he", "en"] as const;
const DEFAULT_LOCALE = "he";
const LOCALE_COOKIE = "NEXT_LOCALE";
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Headers the proxy sets on the inner request so that server components
// can read the verified user info without a second Supabase round-trip.
// These are stripped from inbound requests first so a malicious client
// cannot forge them — only the proxy may set them.
const TOTO_USER_ID_HEADER = "x-toto-user-id";
const TOTO_USER_EMAIL_HEADER = "x-toto-user-email";

// Pages that an unauthenticated user is allowed to see. Each entry is the
// path AFTER the locale segment (no leading slash). Empty string = landing.
// "signup" covers both /signup (the request form) and /signup/thanks (the
// post-submit confirmation) via the prefix match in isPublic(). "rules"
// is the public game-rules page - guests browsing the landing should be
// able to read what they would be signing up for.
const PUBLIC_PATHS = ["", "login", "signup", "rules"];

function isLocale(value: string | undefined): value is (typeof LOCALES)[number] {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

function pickLocale(request: NextRequest): string {
  // Hebrew is the product default - this is a Hebrew-first friends pool.
  // Honour an explicit user choice from the cookie (set by the in-app
  // language switcher), but ignore the browser's Accept-Language header.
  // A first-time visitor whose browser is configured for English still
  // lands on the Hebrew site and can switch from the profile menu.
  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  return DEFAULT_LOCALE;
}

function rememberLocale(response: NextResponse, locale: string) {
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}

function stripLocale(pathname: string): { locale: string | null; rest: string } {
  for (const l of LOCALES) {
    const prefix = `/${l}`;
    if (pathname === prefix) return { locale: l, rest: "" };
    if (pathname.startsWith(`${prefix}/`)) {
      return { locale: l, rest: pathname.slice(prefix.length + 1) };
    }
  }
  return { locale: null, rest: pathname };
}

function isPublic(pathAfterLocale: string): boolean {
  if (PUBLIC_PATHS.includes(pathAfterLocale)) return true;
  return PUBLIC_PATHS.some(
    (p) => p && (pathAfterLocale === p || pathAfterLocale.startsWith(p + "/")),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /auth/* and /api/* are locale-free and bypass the user gate. Each API
  // route handles its own authorization.
  if (pathname.startsWith("/auth/") || pathname.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  // 1) Locale redirect.
  const { locale: currentLocale, rest } = stripLocale(pathname);
  if (!currentLocale) {
    const locale = pickLocale(request);
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    const redirect = NextResponse.redirect(url);
    rememberLocale(redirect, locale);
    return redirect;
  }

  // Strip any inbound forgery attempts of the user-id header BEFORE we
  // read it anywhere downstream. The proxy is the only thing allowed to
  // set this.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TOTO_USER_ID_HEADER);
  requestHeaders.delete(TOTO_USER_EMAIL_HEADER);

  // 2) Refresh Supabase session and read the current user.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supaUrl || !anonKey) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Refreshed cookies returned by the supabase client are collected and
  // applied to the final response at the bottom of the function, so we
  // don't have to keep rebuilding the response while the user header is
  // also in flight.
  const refreshedCookies: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];

  const supabase = createServerClient(supaUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        toSet.forEach(({ name, value, options }) =>
          refreshedCookies.push({ name, value, options: options as CookieOptions }),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 3) Gate protected pages.
  if (!user && !isPublic(rest)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${currentLocale}/login`;
    const redirect = NextResponse.redirect(url);
    rememberLocale(redirect, currentLocale);
    refreshedCookies.forEach(({ name, value, options }) =>
      redirect.cookies.set(name, value, options),
    );
    return redirect;
  }

  // Already signed in but on /login → push to onboarding.
  if (user && rest === "login") {
    const url = request.nextUrl.clone();
    url.pathname = `/${currentLocale}/onboarding`;
    const redirect = NextResponse.redirect(url);
    rememberLocale(redirect, currentLocale);
    refreshedCookies.forEach(({ name, value, options }) =>
      redirect.cookies.set(name, value, options),
    );
    return redirect;
  }

  // Pass the verified user info to server components so the layout can
  // branch on signed-in state without a second Supabase round-trip.
  if (user) {
    requestHeaders.set(TOTO_USER_ID_HEADER, user.id);
    if (user.email) requestHeaders.set(TOTO_USER_EMAIL_HEADER, user.email);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  refreshedCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );

  if (request.cookies.get(LOCALE_COOKIE)?.value !== currentLocale) {
    rememberLocale(response, currentLocale);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|favicon|.*\\..*).*)"],
};
