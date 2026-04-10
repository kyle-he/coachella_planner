import { NextRequest, NextResponse } from "next/server";
import {
  getAppUrl,
  SpotifyScopeError,
  getCurrentUserProfile,
  getSpotifyRedirectUri,
  getTokens,
  getCanonicalAppOrigin,
} from "@/lib/spotify";
import {
  REQUIRED_SPOTIFY_SCOPE_STRING,
  applySpotifySessionCookies,
  clearSpotifyOauthStateCookie,
  clearSpotifySessionCookies,
  createSpotifySessionId,
  hasRequiredSpotifyScopes,
  verifySpotifyOauthState,
} from "@/lib/spotify-session";

export async function GET(request: NextRequest) {
  const redirectWithError = (code: string) => {
    const response = NextResponse.redirect(getAppUrl(request, `/?error=${code}`));
    clearSpotifySessionCookies(response);
    return response;
  };

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = request.nextUrl.searchParams.get("state");

  if (error || !code) {
    return redirectWithError("auth_failed");
  }
  if (!verifySpotifyOauthState(request, state)) {
    return redirectWithError("oauth_state");
  }

  try {
    const redirectUri = getSpotifyRedirectUri(getCanonicalAppOrigin(request));
    const tokens = await getTokens(code, redirectUri);
    const grantedScope = tokens.scope || REQUIRED_SPOTIFY_SCOPE_STRING;

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error("Spotify token response missing access_token or refresh_token");
      return redirectWithError("token_incomplete");
    }
    if (!hasRequiredSpotifyScopes(grantedScope)) {
      console.error("Spotify token missing required scopes:", grantedScope);
      return redirectWithError("insufficient_scope");
    }

    let profile: string | null = null;
    try {
      const full = await getCurrentUserProfile(tokens.access_token);
      const displayName = full.display_name || full.id;
      if (displayName) {
        profile = JSON.stringify({
          display_name: displayName,
          images: (full.images || []).slice(0, 2),
        });
      }
    } catch (e) {
      console.warn("Failed to fetch profile at login:", e);
    }

    // Generate a unique session ID so the client can detect re-logins
    // and invalidate stale caches (localStorage, etc.).
    const sessionId = createSpotifySessionId();

    // Return a 200 HTML page that sets cookies via response headers, then
    // redirects client-side. Browsers often silently drop Set-Cookie on
    // 3xx redirects, which causes the session to be lost.
    const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/schedule"></head><body>Redirecting…</body></html>`;

    const response = new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

    clearSpotifySessionCookies(response);
    clearSpotifyOauthStateCookie(response);
    applySpotifySessionCookies(response, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scope: grantedScope,
      profile,
      sessionId,
    });

    return response;
  } catch (e) {
    if (e instanceof SpotifyScopeError) {
      console.error("Spotify scope validation failed during callback:", e.message);
      return redirectWithError("insufficient_scope");
    }
    console.error("Token exchange error:", e);
    return redirectWithError("token_failed");
  }
}
