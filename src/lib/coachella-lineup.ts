import type { DeezerArtist } from "@/lib/deezer";
import type { Artist } from "@/lib/coachella-data";
import { spotifyArtistSearchUrl } from "@/lib/spotify-open";
import lineupMeta from "@/lib/coachella-lineup-meta.json";

/**
 * Static snapshot from `scripts/sync-coachella-lineup.mjs` (Coachella lineup widget JSON).
 * No runtime fetch — regenerate the JSON when the festival updates the site.
 */
export type CoachellaLineupEntry = {
  title: string;
  imageUrl: string;
  spotifyUrl: string | null;
};

const byKey = lineupMeta.byKey as Record<string, CoachellaLineupEntry>;

/** Schedule display name → key used in `byKey` (typos / suffixes on coachella.com). */
const LINEUP_KEY_ALIASES: Record<string, string> = {
  february: "febuary",
  "groove armada": "groove armada dj set",
  worship: "worship sub focus dimension culture shock 1991",
  royksopp: "royksopp dj set",
};

function resolveLineupLookupKey(key: string): string {
  return LINEUP_KEY_ALIASES[key] ?? key;
}

export function normalizeCoachellaLineupKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "o")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getCoachellaLineupMeta(artist: Artist): CoachellaLineupEntry | null {
  const keys = [
    resolveLineupLookupKey(normalizeCoachellaLineupKey(artist.name)),
    ...(artist.spotifyName
      ? [
          resolveLineupLookupKey(
            normalizeCoachellaLineupKey(artist.spotifyName)
          ),
        ]
      : []),
  ];
  const tried = [...new Set(keys)];
  for (const k of tried) {
    const e = byKey[k];
    if (e) return e;
  }
  return null;
}

export function enrichDeezerArtistFromLineup(
  lineupArtist: Artist,
  deezer: DeezerArtist
): { image: string; link: string } {
  const meta = getCoachellaLineupMeta(lineupArtist);
  const image =
    meta?.imageUrl && meta.imageUrl.length > 0
      ? meta.imageUrl
      : deezer.picture_big || deezer.picture_medium;
  const link =
    meta?.spotifyUrl && meta.spotifyUrl.length > 0
      ? meta.spotifyUrl
      : spotifyArtistSearchUrl(lineupArtist.spotifyName || lineupArtist.name);
  return { image, link };
}
