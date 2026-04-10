import { NextRequest, NextResponse } from "next/server";
import {
  getCanonicalAppOrigin,
  getAppUrl,
  getAuthUrl,
  getSpotifyRedirectUri,
} from "@/lib/spotify";
import {
  clearSpotifySessionCookies,
  createSpotifyOauthState,
  setSpotifyOauthStateCookie,
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
  try {
    const appOrigin = getCanonicalAppOrigin(request);

    if (request.nextUrl.origin !== appOrigin) {
      return NextResponse.redirect(
        new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, appOrigin)
      );
    }

    const redirectUri = getSpotifyRedirectUri(appOrigin);
    const state = createSpotifyOauthState();
    const response = htmlRedirect(getAuthUrl(redirectUri, state));
    clearSpotifySessionCookies(response);
    setSpotifyOauthStateCookie(response, state);
    return response;
  } catch (e) {
    console.error("[auth/login]", e);
    return NextResponse.redirect(getAppUrl(request, "/?error=oauth_config"));
  }
}
