import { NextRequest, NextResponse } from "next/server";
import { getUserInfo, LastfmNotFoundError } from "@/lib/lastfm";
import { setLastfmSessionCookie } from "@/lib/lastfm-session";
import { auth } from "@/auth";
import { setLastfmUsername } from "@/lib/user-profile";

export async function POST(request: NextRequest) {
  let username: string;
  try {
    const body = (await request.json()) as { username?: unknown };
    username =
      typeof body.username === "string" ? body.username.trim() : "";
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!username) {
    return NextResponse.json(
      { error: "Username is required" },
      { status: 400 }
    );
  }

  try {
    await getUserInfo(username);
  } catch (e) {
    if (e instanceof LastfmNotFoundError) {
      return NextResponse.json(
        {
          error: `Could not find Last.fm user "${username}". Check the spelling and try again.`,
        },
        { status: 404 }
      );
    }
    console.error("[auth/login] Last.fm API error:", e);
    return NextResponse.json(
      { error: "Could not connect to Last.fm. Please try again." },
      { status: 503 }
    );
  }

  const response = NextResponse.json({ ok: true });
  setLastfmSessionCookie(response, username);

  // Best-effort: if the user is Google-authenticated, persist the Last.fm
  // username in Firestore so it can be recovered on other devices/browsers.
  const session = await auth().catch(() => null);
  if (session?.user?.email) {
    setLastfmUsername(session.user.email, username).catch((err) => {
      console.warn("[auth/login] Could not persist lastfmUsername:", err);
    });
  }

  return response;
}
