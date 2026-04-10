import { NextRequest, NextResponse } from "next/server";
import {
  SpotifyForbiddenError,
  SpotifyUnauthorizedError,
  getCurrentUserProfile,
  refreshAccessToken,
} from "@/lib/spotify";
import {
  SPOTIFY_COOKIE_OPTS,
  clearSpotifySessionCookies,
  getSpotifySessionIssue,
  readSpotifySession,
} from "@/lib/spotify-session";

// ── Cookie config (must match auth routes) ───────────────────────────

const EMPTY_PROFILE: {
  display_name: string;
  images: { url: string }[];
} = { display_name: "", images: [] };

function isFakeProfile(profile: {
  display_name?: string;
  images?: { url: string }[];
} | null | undefined) {
  if (!profile) return true;
  return profile.display_name === "Spotify User";
}

// ── Token validation (no Spotify API calls) ──────────────────────────

async function getValidToken(request: NextRequest) {
  const session = readSpotifySession(request);
  if (!session) return null;

  if (session.expiresAt && Date.now() < session.expiresAt - 60000) {
    return {
      accessToken: session.accessToken,
      refreshed: false,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      profileCookie: session.profileCookie,
    };
  }

  try {
    const newTokens = await refreshAccessToken(session.refreshToken);
    return {
      accessToken: newTokens.access_token as string,
      refreshed: true,
      refreshToken: (newTokens.refresh_token as string) || session.refreshToken,
      expiresAt: Date.now() + newTokens.expires_in * 1000,
      profileCookie: session.profileCookie,
    };
  } catch {
    return null;
  }
}

// ── GET /api/me ──────────────────────────────────────────────────────
//
// This endpoint exists to:
//   1. Confirm the user has a valid Spotify session (auth cookies present)
//   2. Return their display name + avatar for the UI
//
// It should NEVER call the Spotify API during normal operation.
// The profile is cached in `sp_profile` at login (/api/auth/callback).
// If the cookie is missing or corrupt, return a placeholder — the user
// is still authenticated, we just don't have their name yet.

export async function GET(request: NextRequest) {
  const sessionIssue = getSpotifySessionIssue(request);
  if (sessionIssue) {
    const response = NextResponse.json(
      { error: "Reauthentication required", code: sessionIssue },
      { status: 401 }
    );
    clearSpotifySessionCookies(response);
    return response;
  }

  const result = await getValidToken(request);
  if (!result) {
    const response = NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
    clearSpotifySessionCookies(response);
    return response;
  }

  // Try the cached profile cookie first (the happy path — no API calls)
  const cachedProfile = result.profileCookie;
  if (cachedProfile) {
    try {
      const profile = JSON.parse(cachedProfile);
      if (!isFakeProfile(profile)) {
        console.log("[/api/me] Returning cached profile:", profile.display_name);
        const response = NextResponse.json(profile);
        if (result.refreshed) {
          response.cookies.set("sp_access", result.accessToken, SPOTIFY_COOKIE_OPTS);
          response.cookies.set("sp_refresh", result.refreshToken, SPOTIFY_COOKIE_OPTS);
          response.cookies.set("sp_expires", String(result.expiresAt), SPOTIFY_COOKIE_OPTS);
        }
        return response;
      }
    } catch {
      // Cookie was corrupt — fall through to placeholder
    }
  }

  // No cached profile (e.g. user logged in before caching was added, or
  // the cookie was lost). Try one direct Spotify fetch and only keep the
  // session if Spotify still allows user-data access.
  console.log("[/api/me] No sp_profile cookie — attempting single Spotify fetch…");
  let profile = EMPTY_PROFILE;

  try {
    const full = await getCurrentUserProfile(result.accessToken);
    const displayName = full.display_name || full.id;
    if (displayName) {
      profile = {
        display_name: displayName,
        images: (full.images || []).slice(0, 2),
      };
      console.log("[/api/me] Spotify fetch OK:", profile.display_name);
    }
  } catch (e) {
    if (
      e instanceof SpotifyUnauthorizedError ||
      e instanceof SpotifyForbiddenError
    ) {
      const response = NextResponse.json(
        {
          error: "Spotify access denied",
          code: "spotify_access_denied",
        },
        { status: 401 }
      );
      clearSpotifySessionCookies(response);
      return response;
    }
    console.warn("[/api/me] Spotify fetch failed — returning empty profile:", e);
  }

  const response = NextResponse.json(profile);

  if (profile.display_name) {
    response.cookies.set("sp_profile", JSON.stringify(profile), SPOTIFY_COOKIE_OPTS);
  } else {
    response.cookies.set("sp_profile", "", {
      ...SPOTIFY_COOKIE_OPTS,
      maxAge: 0,
    });
  }

  if (result.refreshed) {
    response.cookies.set("sp_access", result.accessToken, SPOTIFY_COOKIE_OPTS);
    response.cookies.set("sp_refresh", result.refreshToken, SPOTIFY_COOKIE_OPTS);
    response.cookies.set("sp_expires", String(result.expiresAt), SPOTIFY_COOKIE_OPTS);
  }

  return response;
}
