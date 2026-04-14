import { NextRequest, NextResponse } from "next/server";
import { getUserInfo, LastfmNotFoundError } from "@/lib/lastfm";
import {
  clearLastfmSessionCookies,
  readLastfmSession,
  setLastfmSessionCookie,
} from "@/lib/lastfm-session";
import { auth } from "@/auth";
import { clearLastfmUsername, getLastfmUsername } from "@/lib/user-profile";

export async function GET(request: NextRequest) {
  let username = readLastfmSession(request);
  let restoredFromDb = false;

  // Cookie missing — check if a verified username was previously stored in
  // Firestore so it can be recovered on a new device/browser session.
  if (!username) {
    const session = await auth().catch(() => null);
    if (session?.user?.email) {
      const dbUsername = await getLastfmUsername(session.user.email).catch(
        () => null
      );
      if (dbUsername) {
        username = dbUsername;
        restoredFromDb = true;
      }
    }
  }

  if (!username) {
    return NextResponse.json({ lastfmUser: null });
  }

  try {
    const info = await getUserInfo(username);
    const displayName = info.realname || info.name;
    const images = (info.image || [])
      .filter((img) => img["#text"])
      .map((img) => ({ url: img["#text"] }));

    const response = NextResponse.json({
      display_name: displayName,
      images,
      username: info.name,
      lastfmUser: info.name,
    });

    // Re-hydrate the cookie if it was missing and we recovered from Firestore
    if (restoredFromDb) {
      setLastfmSessionCookie(response, username);
    }

    return response;
  } catch (e) {
    if (e instanceof LastfmNotFoundError) {
      // Username is no longer valid — clean up cookie and Firestore entry
      const response = NextResponse.json({ lastfmUser: null });
      clearLastfmSessionCookies(response);
      if (restoredFromDb) {
        const session = await auth().catch(() => null);
        if (session?.user?.email) {
          clearLastfmUsername(session.user.email).catch(() => {});
        }
      }
      return response;
    }
    console.warn("[/api/me] Last.fm fetch failed — returning basic profile:", e);
    const response = NextResponse.json({
      display_name: username,
      images: [],
      username,
      lastfmUser: username,
    });
    if (restoredFromDb) {
      setLastfmSessionCookie(response, username);
    }
    return response;
  }
}
