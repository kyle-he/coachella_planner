import type { NextRequest, NextResponse } from "next/server";

export const LASTFM_COOKIE = "lf_user";

export const LASTFM_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 30, // 30 days
  path: "/",
};

export function setLastfmSessionCookie(
  response: NextResponse,
  username: string
) {
  response.cookies.set(LASTFM_COOKIE, username, LASTFM_COOKIE_OPTS);
}

export function clearLastfmSessionCookies(response: NextResponse) {
  response.cookies.set(LASTFM_COOKIE, "", {
    ...LASTFM_COOKIE_OPTS,
    maxAge: 0,
  });
}

export function readLastfmSession(request: NextRequest): string | null {
  const username = request.cookies.get(LASTFM_COOKIE)?.value;
  if (!username || username.trim().length === 0) return null;
  return username.trim();
}
