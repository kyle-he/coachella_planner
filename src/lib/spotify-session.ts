import { timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const SPOTIFY_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 30,
  path: "/",
};

export const SPOTIFY_AUTH_VERSION = "3";
export const SPOTIFY_OAUTH_STATE_COOKIE = "sp_oauth_state";
export const SPOTIFY_OAUTH_STATE_COOKIE_OPTS = {
  ...SPOTIFY_COOKIE_OPTS,
  maxAge: 60 * 10,
};

export const REQUIRED_SPOTIFY_SCOPES = [
  "user-top-read",
  "user-read-recently-played",
  "user-library-read",
  "user-follow-read",
] as const;

export const REQUIRED_SPOTIFY_SCOPE_STRING = REQUIRED_SPOTIFY_SCOPES.join(" ");

export interface SpotifySessionState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  scope: string;
  authVersion: string | null;
  profileCookie: string | null;
  sessionId: string | null;
}

export type SpotifySessionIssue =
  | "missing_tokens"
  | "session_upgrade_required"
  | "insufficient_scope";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function createSpotifyOauthState(): string {
  return `${Date.now()}.${crypto.randomUUID().replace(/-/g, "")}`;
}

export function setSpotifyOauthStateCookie(
  response: NextResponse,
  state: string
) {
  response.cookies.set(
    SPOTIFY_OAUTH_STATE_COOKIE,
    state,
    SPOTIFY_OAUTH_STATE_COOKIE_OPTS
  );
}

export function clearSpotifyOauthStateCookie(response: NextResponse) {
  response.cookies.set(SPOTIFY_OAUTH_STATE_COOKIE, "", {
    ...SPOTIFY_OAUTH_STATE_COOKIE_OPTS,
    maxAge: 0,
  });
}

export function verifySpotifyOauthState(
  request: NextRequest,
  state: string | null | undefined
): boolean {
  if (!state) return false;

  const [ts, nonce] = state.split(".");
  if (!ts || !nonce) return false;

  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt)) return false;
  if (Math.abs(Date.now() - issuedAt) > OAUTH_STATE_TTL_MS) return false;

  const cookieState =
    request.cookies.get(SPOTIFY_OAUTH_STATE_COOKIE)?.value ?? null;
  if (!cookieState) return false;

  const stateBuf = Buffer.from(state);
  const cookieBuf = Buffer.from(cookieState);
  if (stateBuf.length !== cookieBuf.length) return false;

  return timingSafeEqual(stateBuf, cookieBuf);
}

export function createSpotifySessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function hasRequiredSpotifyScopes(scopeValue: string | null | undefined): boolean {
  if (!scopeValue) return false;
  const granted = new Set(
    scopeValue
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean)
  );
  return REQUIRED_SPOTIFY_SCOPES.every((scope) => granted.has(scope));
}

export function getSpotifySessionIssue(
  request: NextRequest
): SpotifySessionIssue | null {
  const accessToken = request.cookies.get("sp_access")?.value;
  const refreshToken = request.cookies.get("sp_refresh")?.value;
  if (!accessToken || !refreshToken) {
    return "missing_tokens";
  }

  const authVersion = request.cookies.get("sp_auth_v")?.value ?? null;
  if (authVersion !== SPOTIFY_AUTH_VERSION) {
    return "session_upgrade_required";
  }

  const scope = request.cookies.get("sp_scope")?.value ?? null;
  if (!hasRequiredSpotifyScopes(scope)) {
    return "insufficient_scope";
  }

  return null;
}

export function readSpotifySession(request: NextRequest): SpotifySessionState | null {
  const issue = getSpotifySessionIssue(request);
  if (issue) return null;

  const accessToken = request.cookies.get("sp_access")?.value;
  const refreshToken = request.cookies.get("sp_refresh")?.value;
  if (!accessToken || !refreshToken) return null;

  const rawExpires = request.cookies.get("sp_expires")?.value ?? "";
  const expiresAt = Number(rawExpires);

  return {
    accessToken,
    refreshToken,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
    scope: request.cookies.get("sp_scope")?.value ?? REQUIRED_SPOTIFY_SCOPE_STRING,
    authVersion: request.cookies.get("sp_auth_v")?.value ?? null,
    profileCookie: request.cookies.get("sp_profile")?.value ?? null,
    sessionId: request.cookies.get("sp_session")?.value ?? null,
  };
}

export function applySpotifySessionCookies(
  response: NextResponse,
  session: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scope: string;
    profile?: string | null;
    sessionId: string;
  }
) {
  response.cookies.set("sp_access", session.accessToken, SPOTIFY_COOKIE_OPTS);
  response.cookies.set("sp_refresh", session.refreshToken, SPOTIFY_COOKIE_OPTS);
  response.cookies.set("sp_expires", String(session.expiresAt), SPOTIFY_COOKIE_OPTS);
  response.cookies.set("sp_scope", session.scope, SPOTIFY_COOKIE_OPTS);
  response.cookies.set("sp_auth_v", SPOTIFY_AUTH_VERSION, SPOTIFY_COOKIE_OPTS);
  if (session.profile) {
    response.cookies.set("sp_profile", session.profile, SPOTIFY_COOKIE_OPTS);
  }
  response.cookies.set("sp_session", session.sessionId, {
    ...SPOTIFY_COOKIE_OPTS,
    httpOnly: false,
  });
}

export function clearSpotifySessionCookies(response: NextResponse) {
  response.cookies.set("sp_access", "", { ...SPOTIFY_COOKIE_OPTS, maxAge: 0 });
  response.cookies.set("sp_refresh", "", { ...SPOTIFY_COOKIE_OPTS, maxAge: 0 });
  response.cookies.set("sp_expires", "", { ...SPOTIFY_COOKIE_OPTS, maxAge: 0 });
  response.cookies.set("sp_scope", "", { ...SPOTIFY_COOKIE_OPTS, maxAge: 0 });
  response.cookies.set("sp_auth_v", "", { ...SPOTIFY_COOKIE_OPTS, maxAge: 0 });
  response.cookies.set("sp_profile", "", { ...SPOTIFY_COOKIE_OPTS, maxAge: 0 });
  response.cookies.set("sp_session", "", {
    ...SPOTIFY_COOKIE_OPTS,
    httpOnly: false,
    maxAge: 0,
  });
  clearSpotifyOauthStateCookie(response);
  response.cookies.set("spotify_tokens", "", {
    ...SPOTIFY_COOKIE_OPTS,
    maxAge: 0,
  });
}
