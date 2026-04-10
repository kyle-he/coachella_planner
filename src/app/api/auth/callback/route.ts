import { NextRequest, NextResponse } from "next/server";
import {
  getAppUrl,
  SpotifyScopeError,
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

function htmlRedirect(target: string) {
  const escaped = JSON.stringify(target);
  const html = `<!DOCTYPE html><html><head><meta charSet="utf-8" /><title>Redirecting…</title></head><body><script>window.location.replace(${escaped});</script><noscript><meta http-equiv="refresh" content="0;url=${target}"></noscript>Redirecting…</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

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

    // Generate a unique session ID so the client can detect re-logins
    // and invalidate stale caches (localStorage, etc.).
    const sessionId = createSpotifySessionId();

    // Keep the callback minimal: exchange tokens, set cookies, and move the
    // browser forward. Profile hydration can happen lazily via /api/me.
    const response = htmlRedirect("/schedule");

    clearSpotifySessionCookies(response);
    clearSpotifyOauthStateCookie(response);
    applySpotifySessionCookies(response, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scope: grantedScope,
      profile: null,
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
