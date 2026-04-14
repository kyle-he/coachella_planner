/** Client-only preference; schedule page reads this when listing track previews. */
export const SHOW_POPULAR_SONGS_KEY = "coachella:showPopularSongs";

export function getShowPopularSongs(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(SHOW_POPULAR_SONGS_KEY);
    if (v === null) return true;
    return v === "true";
  } catch {
    return true;
  }
}

export function setShowPopularSongsPreference(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SHOW_POPULAR_SONGS_KEY, String(value));
    window.dispatchEvent(new Event("coachella-prefs-changed"));
  } catch {
    /* ignore */
  }
}
