import { getDoc, setDoc } from "./firestore-rest";

export interface UserPrefsData {
  showPopularSongs?: boolean;
  updatedAt: number;
}

export async function getUserPrefs(email: string): Promise<UserPrefsData | null> {
  const data = await getDoc(`userPrefs/${email}`);
  if (!data) return null;
  const out: UserPrefsData = { updatedAt: Number(data.updatedAt ?? 0) };
  if (typeof data.showPopularSongs === "boolean") {
    out.showPopularSongs = data.showPopularSongs;
  }
  return out;
}

export async function setUserPrefs(
  email: string,
  prefs: Partial<Omit<UserPrefsData, "updatedAt">>
): Promise<UserPrefsData> {
  // Read-merge so a partial update doesn't clobber unrelated fields
  const current = await getUserPrefs(email);
  const merged: UserPrefsData = {
    showPopularSongs:
      prefs.showPopularSongs !== undefined
        ? prefs.showPopularSongs
        : current?.showPopularSongs,
    updatedAt: Date.now(),
  };
  const payload: Record<string, unknown> = { updatedAt: merged.updatedAt };
  if (merged.showPopularSongs !== undefined) {
    payload.showPopularSongs = merged.showPopularSongs;
  }
  await setDoc(`userPrefs/${email}`, payload);
  return merged;
}
