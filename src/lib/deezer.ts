// Deezer public API client — no authentication required
// Used for artist search, top tracks (with 30s previews), images, and related artists

import { promises as fs } from "node:fs";
import path from "node:path";

const BASE = "https://api.deezer.com";
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_PATH = path.join(CACHE_DIR, "deezer-api-cache.json");

const SEARCH_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days (lineup is static)
const TOP_TRACKS_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const RELATED_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

interface CacheEntry<T> {
  savedAt: number;
  value: T;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
let cacheLoaded = false;
let cacheWritePromise: Promise<void> | null = null;

async function loadCacheOnce() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, CacheEntry<unknown>>;
    for (const [k, v] of Object.entries(parsed || {})) {
      if (v && typeof v.savedAt === "number") memoryCache.set(k, v);
    }
  } catch {
    // Missing/corrupt cache is non-fatal.
  }
}

function scheduleCacheWrite() {
  if (cacheWritePromise) return;
  cacheWritePromise = (async () => {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      const payload: Record<string, CacheEntry<unknown>> = {};
      for (const [k, v] of memoryCache.entries()) payload[k] = v;
      await fs.writeFile(CACHE_PATH, JSON.stringify(payload), "utf8");
    } catch {
      // Cache write failure should never break API calls.
    } finally {
      cacheWritePromise = null;
    }
  })();
}

async function getCached<T>(key: string, ttlMs: number): Promise<T | null> {
  await loadCacheOnce();
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > ttlMs) {
    memoryCache.delete(key);
    scheduleCacheWrite();
    return null;
  }
  return hit.value as T;
}

function setCached<T>(key: string, value: T) {
  memoryCache.set(key, { savedAt: Date.now(), value });
  scheduleCacheWrite();
}

export interface DeezerArtist {
  id: number;
  name: string;
  link: string;
  picture: string;
  picture_small: string;
  picture_medium: string;
  picture_big: string;
  picture_xl: string;
  nb_album: number;
  nb_fan: number;
  radio: boolean;
  tracklist: string;
}

export interface DeezerTrack {
  id: number;
  readable: boolean;
  title: string;
  title_short: string;
  link: string;
  duration: number; // seconds
  rank: number;
  preview: string; // 30s MP3 URL — always present
  artist: { id: number; name: string };
  album: {
    id: number;
    title: string;
    cover: string;
    cover_small: string;
    cover_medium: string;
    cover_big: string;
    cover_xl: string;
  };
}

export interface DeezerSearchResult {
  data: DeezerArtist[];
  total: number;
}

export interface DeezerTrackList {
  data: DeezerTrack[];
  total: number;
}

export interface DeezerRelatedResult {
  data: DeezerArtist[];
  total: number;
}

// Retry with exponential backoff for rate limits
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 400
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) throw e;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

async function deezerFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Deezer API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  // Deezer returns errors as 200 with an error object
  if (data.error) {
    throw new Error(
      `Deezer error: ${data.error.type} — ${data.error.message}`
    );
  }
  return data as T;
}

// ── Public API ──────────────────────────────────────────────────────

export async function searchArtist(
  name: string,
  limit = 5
): Promise<DeezerSearchResult> {
  const key = `searchArtist:${name.toLowerCase()}:${limit}`;
  const cached = await getCached<DeezerSearchResult>(key, SEARCH_TTL_MS);
  if (cached) return cached;
  const fresh = await withRetry(() =>
    deezerFetch<DeezerSearchResult>(
      `/search/artist?q=${encodeURIComponent(name)}&limit=${limit}`
    )
  );
  setCached(key, fresh);
  return fresh;
}

export async function getArtistTopTracks(
  artistId: number,
  limit = 50
): Promise<DeezerTrackList> {
  const key = `getArtistTopTracks:${artistId}:${limit}`;
  const cached = await getCached<DeezerTrackList>(key, TOP_TRACKS_TTL_MS);
  if (cached) return cached;
  const fresh = await withRetry(() =>
    deezerFetch<DeezerTrackList>(`/artist/${artistId}/top?limit=${limit}`)
  );
  setCached(key, fresh);
  return fresh;
}

export async function getRelatedArtists(
  artistId: number,
  limit = 20
): Promise<DeezerRelatedResult> {
  const key = `getRelatedArtists:${artistId}:${limit}`;
  const cached = await getCached<DeezerRelatedResult>(key, RELATED_TTL_MS);
  if (cached) return cached;
  const fresh = await withRetry(() =>
    deezerFetch<DeezerRelatedResult>(
      `/artist/${artistId}/related?limit=${limit}`
    )
  );
  setCached(key, fresh);
  return fresh;
}
