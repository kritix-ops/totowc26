import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const LOCALES = ["he", "en"] as const;
const DEFAULT_LOCALE = "he";
const LOCALE_COOKIE = "NEXT_LOCALE";
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Pages that an unauthenticated user is allowed to see. Each entry is the
// path AFTER the locale segment (no leading slash). Empty string = landing.
const PUBLIC_PATHS = ["", "login"];

function isLocale(value: string | undefined): value is (typeof LOCALES)[number] {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

function pickLocale(request: NextRequest): string {
  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;

  const header = request.headers.get("accept-language") ?? "";
  const preferred = header
    .split(",")
    .map((part) => part.split(";")[0].trim().toLowerCase().slice(0, 2));
  for (const lang of preferred) {
    if (isLocale(lang)) return lang;
  }
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

  // 2) Refresh Supabase session and read the current user.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supaUrl || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supaUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options as CookieOptions),
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
    return redirect;
  }

  // Already signed in but on /login → push to onboarding.
  if (user && rest === "login") {
    const url = request.nextUrl.clone();
    url.pathname = `/${currentLocale}/onboarding`;
    const redirect = NextResponse.redirect(url);
    rememberLocale(redirect, currentLocale);
    return redirect;
  }

  if (request.cookies.get(LOCALE_COOKIE)?.value !== currentLocale) {
    rememberLocale(response, currentLocale);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|favicon|.*\\..*).*)"],
};
