import type { NextRequest } from "next/server";
import {
  REQUIRED_SPOTIFY_SCOPES,
} from "@/lib/spotify-session";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";

const SPOTIFY_TIMEOUT_MS = 7_000;

/** Hard cap so serverless handlers do not run unbounded. */
const SPOTIFY_429_MAX_ATTEMPTS = 3;
const SPOTIFY_429_MAX_TOTAL_MS = 8_000;
/** Longest single wait between retries (Retry-After or backoff). */
const SPOTIFY_429_MAX_DELAY_MS = 2_500;

const CALLBACK_PATH = "/api/auth/callback";

function parseRetryAfterMs(headers: Headers): number {
  const raw = headers.get("Retry-After");
  if (!raw) return 0;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0) {
    // Very large values are often HTTP-date epoch confusion; treat as seconds only when sane
    if (asNum > 86_400) {
      const d = Date.parse(raw);
      if (!Number.isNaN(d)) {
        return Math.min(
          SPOTIFY_429_MAX_DELAY_MS,
          Math.max(0, d - Date.now())
        );
      }
      return 5_000;
    }
    return Math.min(SPOTIFY_429_MAX_DELAY_MS, Math.max(0, asNum * 1000));
  }
  const d = Date.parse(raw);
  if (!Number.isNaN(d)) {
    return Math.min(
      SPOTIFY_429_MAX_DELAY_MS,
      Math.max(0, d - Date.now())
    );
  }
  return 5_000;
}

/**
 * Fetch with 429 handling: keep retrying until success or limits hit — never
 * return a 429 response to callers (they would turn it into empty lists).
 */
async function spotifyFetchWith429Retries(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const t0 = Date.now();
  let attempt = 0;
  let backoffMs = 1_500;

  while (true) {
    attempt += 1;
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
    });

    if (res.status !== 429) {
      return res;
    }

    const retryAfterMs = parseRetryAfterMs(res.headers);
    const waitMs = Math.min(
      SPOTIFY_429_MAX_DELAY_MS,
      Math.max(retryAfterMs, backoffMs * 0.85 + Math.random() * 600)
    );
    backoffMs = Math.min(backoffMs * 1.65, 45_000);

    const overAttempts = attempt >= SPOTIFY_429_MAX_ATTEMPTS;
    const overTime = Date.now() - t0 > SPOTIFY_429_MAX_TOTAL_MS;
    if (overAttempts || overTime) {
      await res.text().catch(() => "");
      throw new Error(
        `Spotify rate limited (${url.split("?")[0]}): 429 after ${attempt} attempts over ${Date.now() - t0}ms`
      );
    }

    console.warn(
      `[spotify] 429 on ${url.split("?")[0]} — retry ${attempt}/${SPOTIFY_429_MAX_ATTEMPTS}, waiting ${Math.round(waitMs / 1000)}s`
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * OAuth redirect_uri must match exactly what is registered in the Spotify app
 * and must match between /authorize and /api/token.
 */
export function getSpotifyRedirectUri(requestOrigin: string): string {
  const fromEnv = process.env.SPOTIFY_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  const base = requestOrigin.replace(/\/$/, "");
  return `${base}${CALLBACK_PATH}`;
}

/**
 * Keep the browser on the same origin as the configured redirect_uri so the
 * OAuth state cookie is written and read on one host.
 */
export function getCanonicalAppOrigin(request: NextRequest): string {
  const requestOrigin = getRequestOrigin(request);

  try {
    return new URL(getSpotifyRedirectUri(requestOrigin)).origin;
  } catch {
    return requestOrigin;
  }
}

export function getAppUrl(request: NextRequest, path: string): string {
  return new URL(path, getCanonicalAppOrigin(request)).toString();
}

export function getRequestOrigin(request: NextRequest): string {
  const explicitOrigin = request.headers.get("origin");
  if (explicitOrigin) {
    return explicitOrigin.replace(/\/$/, "");
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore malformed referers and fall back to host headers.
    }
  }

  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return request.nextUrl.origin;

  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`;
}

/**
 * Spotify HTTP helper: timeout on each attempt; 429 → retry with backoff +
 * Retry-Until success or throw (no silent empty data). Web API requests are
 * not serialized so callers can bulk-fetch endpoints in parallel.
 */
function spotifyFetch(url: string, init?: RequestInit): Promise<Response> {
  return spotifyFetchWith429Retries(url, init);
}

/** Thrown when the Web API returns 401 so callers can refresh and retry once. */
export class SpotifyUnauthorizedError extends Error {
  readonly name = "SpotifyUnauthorizedError";
  constructor(message = "Spotify access token rejected (401)") {
    super(message);
  }
}

/** Thrown when Spotify says the token/app lacks required scopes. */
export class SpotifyScopeError extends Error {
  readonly name = "SpotifyScopeError";
  constructor(message = "Spotify token is missing required scopes") {
    super(message);
  }
}

/** Thrown when Spotify rejects a user-data request with 403. */
export class SpotifyForbiddenError extends Error {
  readonly name = "SpotifyForbiddenError";

  constructor(
    message = "Spotify refused access to the requested user data",
    readonly detail: string = ""
  ) {
    super(message);
  }
}

async function readSpotifyErrorDetail(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    if (!raw.trim()) return "";
    const parsed = JSON.parse(raw) as {
      error?: string | { message?: string; reason?: string };
    };
    if (typeof parsed?.error === "string") return parsed.error;
    return parsed?.error?.message || parsed?.error?.reason || raw.slice(0, 180);
  } catch {
    return "";
  }
}

async function readSpotifyUserJson<T>(res: Response, label: string, fallback: T): Promise<T> {
  if (res.status === 401) {
    await res.text().catch(() => "");
    throw new SpotifyUnauthorizedError();
  }
  if (res.status === 204) {
    await res.text().catch(() => "");
    return fallback;
  }
  if (!res.ok) {
    const detail = await readSpotifyErrorDetail(res);
    if (
      res.status === 403 &&
      /insufficient client scope|scope/i.test(detail)
    ) {
      throw new SpotifyScopeError(
        detail || `${label} requires additional Spotify scopes`
      );
    }
    if (res.status === 403) {
      throw new SpotifyForbiddenError(
        `${label} is forbidden for this Spotify session`,
        detail
      );
    }
    console.warn(`[spotify] ${label} HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    return fallback;
  }
  const text = await res.text();
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    console.warn(`[spotify] ${label} response was not valid JSON`);
    return fallback;
  }
}

export async function getCurrentUserProfile(accessToken: string) {
  const res = await spotifyFetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return readSpotifyUserJson<{
    display_name?: string;
    id?: string;
    images?: { url: string }[];
  }>(res, "me", {});
}

export function getAuthUrl(redirectUri: string, state: string): string {
  if (!SPOTIFY_CLIENT_ID) {
    throw new Error("SPOTIFY_CLIENT_ID is not set");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CLIENT_ID,
    scope: REQUIRED_SPOTIFY_SCOPES.join(" "),
    redirect_uri: redirectUri,
    state,
    show_dialog: "true",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function getTokens(code: string, redirectUri: string) {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error("Spotify client credentials are not set");
  }
  const res = await spotifyFetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to get tokens (${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`
    );
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await spotifyFetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error("Failed to refresh token");
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>;
}

export async function getTopArtists(
  accessToken: string,
  timeRange: string = "medium_term",
  limit: number = 50
) {
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/me/top/artists?time_range=${timeRange}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return readSpotifyUserJson<{ items: unknown[] }>(res, `me/top/artists (${timeRange})`, {
    items: [],
  });
}

export async function getTopTracks(
  accessToken: string,
  timeRange: string = "medium_term",
  limit: number = 50
) {
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return readSpotifyUserJson<{ items: unknown[] }>(res, `me/top/tracks (${timeRange})`, {
    items: [],
  });
}

export async function searchArtist(accessToken: string, artistName: string) {
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=5`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return { artists: { items: [] } };
  return res.json();
}

export async function getArtistTopTracks(
  accessToken: string,
  artistId: string
) {
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/artists/${artistId}/top-tracks`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return { tracks: [] };
  return res.json();
}

export async function getRecentlyPlayed(
  accessToken: string,
  limit: number = 50
) {
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return readSpotifyUserJson<{ items: unknown[] }>(res, "me/player/recently-played", {
    items: [],
  });
}

export async function getSavedTracks(
  accessToken: string,
  limit: number = 50,
  offset: number = 0
) {
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return readSpotifyUserJson<{ items: unknown[] }>(res, "me/tracks", { items: [] });
}

export async function getFollowedArtists(accessToken: string, limit: number = 50) {
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/me/following?type=artist&limit=${limit}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return readSpotifyUserJson<{ artists?: { items?: unknown[] } }>(
    res,
    "me/following",
    { artists: { items: [] } }
  );
}


export async function getRelatedArtists(
  accessToken: string,
  artistId: string
) {
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/artists/${artistId}/related-artists`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return { artists: [] };
  return res.json();
}
