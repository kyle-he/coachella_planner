const LASTFM_API_KEY = process.env.LASTFM_API_KEY ?? "";
const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_TIMEOUT_MS = 8_000;

export class LastfmNotFoundError extends Error {
  readonly name = "LastfmNotFoundError";
  constructor(message = "Last.fm user not found") {
    super(message);
  }
}

export class LastfmError extends Error {
  readonly name = "LastfmError";
  constructor(message = "Last.fm API error") {
    super(message);
  }
}

async function lastfmFetch(
  method: string,
  params: Record<string, string>
): Promise<unknown> {
  if (!LASTFM_API_KEY) {
    throw new LastfmError("LASTFM_API_KEY is not set");
  }
  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", method);
  url.searchParams.set("api_key", LASTFM_API_KEY);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS),
    headers: { "User-Agent": "CoachellaPlanner/1.0" },
  });

  if (!res.ok) {
    throw new LastfmError(`Last.fm API returned ${res.status}`);
  }

  const data = (await res.json()) as {
    error?: number;
    message?: string;
    [key: string]: unknown;
  };

  if (data.error) {
    if (data.error === 6) {
      throw new LastfmNotFoundError(data.message || "User not found");
    }
    throw new LastfmError(data.message || `Last.fm error ${data.error}`);
  }

  return data;
}

export interface LastfmArtistItem {
  name: string;
  playcount: string;
  mbid?: string;
  url: string;
  image?: { "#text": string; size: string }[];
}

export interface LastfmTrackItem {
  name: string;
  playcount?: string;
  duration?: string;
  mbid?: string;
  url: string;
  image?: { "#text": string; size: string }[];
  artist: {
    name?: string;
    "#text"?: string;
    mbid?: string;
    url?: string;
  };
  "@attr"?: { rank?: string; nowplaying?: string };
  date?: { uts: string; "#text": string };
}

export interface LastfmUser {
  name: string;
  realname?: string;
  image?: { "#text": string; size: string }[];
  url: string;
  playcount?: string;
}

export async function getUserInfo(username: string): Promise<LastfmUser> {
  const data = (await lastfmFetch("user.getinfo", { user: username })) as {
    user: LastfmUser;
  };
  return data.user;
}

export type LastfmPeriod =
  | "overall"
  | "7day"
  | "1month"
  | "3month"
  | "6month"
  | "12month";

export async function getUserTopArtists(
  username: string,
  period: LastfmPeriod = "overall",
  limit: number = 50
): Promise<LastfmArtistItem[]> {
  const data = (await lastfmFetch("user.gettopartists", {
    user: username,
    period,
    limit: String(limit),
  })) as { topartists: { artist: LastfmArtistItem[] | LastfmArtistItem } };
  const artists = data.topartists.artist;
  if (!artists) return [];
  return Array.isArray(artists) ? artists : [artists];
}

export async function getUserTopTracks(
  username: string,
  period: LastfmPeriod = "overall",
  limit: number = 50
): Promise<LastfmTrackItem[]> {
  const data = (await lastfmFetch("user.gettoptracks", {
    user: username,
    period,
    limit: String(limit),
  })) as { toptracks: { track: LastfmTrackItem[] | LastfmTrackItem } };
  const tracks = data.toptracks.track;
  if (!tracks) return [];
  return Array.isArray(tracks) ? tracks : [tracks];
}

export async function getUserRecentTracks(
  username: string,
  limit: number = 50
): Promise<LastfmTrackItem[]> {
  const data = (await lastfmFetch("user.getrecenttracks", {
    user: username,
    limit: String(limit),
  })) as { recenttracks: { track: LastfmTrackItem[] | LastfmTrackItem } };
  const tracks = data.recenttracks.track;
  if (!tracks) return [];
  const arr = Array.isArray(tracks) ? tracks : [tracks];
  // Filter out the "now playing" placeholder which has no date
  return arr.filter((t) => !t["@attr"]?.nowplaying);
}
