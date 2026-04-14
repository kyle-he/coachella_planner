import { NextRequest, NextResponse } from "next/server";
import { clearLastfmSessionCookies } from "@/lib/lastfm-session";
import { auth } from "@/auth";
import { clearLastfmUsername } from "@/lib/user-profile";

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
  const target = next?.startsWith("/") ? next : "/";
  const response = htmlRedirect(
    new URL(target, request.nextUrl.origin).toString()
  );
  clearLastfmSessionCookies(response);

  // Best-effort: if the user is Google-authenticated, clear the persisted
  // Last.fm username from Firestore so the link is truly removed.
  const session = await auth().catch(() => null);
  if (session?.user?.email) {
    clearLastfmUsername(session.user.email).catch((err) => {
      console.warn("[auth/logout] Could not clear lastfmUsername:", err);
    });
  }

  return response;
}
