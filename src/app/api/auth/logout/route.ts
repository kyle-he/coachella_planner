import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/spotify";
import { clearSpotifySessionCookies } from "@/lib/spotify-session";

function htmlRedirect(target: string) {
  const escaped = JSON.stringify(target);
  const html = `<!DOCTYPE html><html><head><meta charSet="utf-8" /><title>Redirecting…</title></head><body><script>window.location.replace(${escaped});</script><noscript><meta http-equiv="refresh" content="0;url=${target}"></noscript>Redirecting…</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");
  const target = next?.startsWith("/") ? next : "/?signed_out=1";
  const response = htmlRedirect(getAppUrl(request, target));
  clearSpotifySessionCookies(response);
  return response;
}
