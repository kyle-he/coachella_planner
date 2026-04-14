import { getDoc, setDoc, updateDoc } from "@/lib/firestore-rest";

export interface UserProfileOverride {
  name: string;
  image: string;
  updatedAt: number;
  lastfmUsername?: string;
}

export async function getUserProfileOverride(
  email: string
): Promise<UserProfileOverride | null> {
  const data = await getDoc(`userProfiles/${email}`);
  if (!data) return null;
  return {
    name: String(data.name ?? ""),
    image: String(data.image ?? ""),
    updatedAt: Number(data.updatedAt ?? 0),
    lastfmUsername: data.lastfmUsername
      ? String(data.lastfmUsername)
      : undefined,
  };
}

export async function upsertUserProfileOverride(
  email: string,
  profile: { name: string; image: string }
): Promise<UserProfileOverride> {
  const payload: UserProfileOverride = {
    name: profile.name.trim(),
    image: profile.image.trim(),
    updatedAt: Date.now(),
  };
  await setDoc(`userProfiles/${email}`, {
    name: payload.name,
    image: payload.image,
    updatedAt: payload.updatedAt,
  });
  return payload;
}

/** Persist a verified Last.fm username on the user's profile for cross-device recovery. */
export async function setLastfmUsername(
  email: string,
  username: string
): Promise<void> {
  // Use updateDoc so we don't clobber name/image written by upsertUserProfileOverride.
  // If the doc doesn't exist yet, fall back to setDoc with just the username.
  const existing = await getDoc(`userProfiles/${email}`);
  if (existing) {
    await updateDoc(`userProfiles/${email}`, {
      lastfmUsername: username.trim(),
      updatedAt: Date.now(),
    });
  } else {
    await setDoc(`userProfiles/${email}`, {
      name: "",
      image: "",
      lastfmUsername: username.trim(),
      updatedAt: Date.now(),
    });
  }
}

/** Clear the stored Last.fm username (called when the user disconnects Last.fm). */
export async function clearLastfmUsername(email: string): Promise<void> {
  const existing = await getDoc(`userProfiles/${email}`);
  if (!existing) return;
  await updateDoc(`userProfiles/${email}`, {
    lastfmUsername: null,
    updatedAt: Date.now(),
  });
}

/** Returns the stored Last.fm username, or null if not set. */
export async function getLastfmUsername(email: string): Promise<string | null> {
  const data = await getDoc(`userProfiles/${email}`);
  const username = data?.lastfmUsername;
  if (typeof username === "string" && username.trim().length > 0) {
    return username.trim();
  }
  return null;
}
