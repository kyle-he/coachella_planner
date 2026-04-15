import type { SetTime } from "@/lib/coachella-data";

/** One Deezer-backed track preview row (matches `/api/recommendations`). */
export interface TrackInfo {
  id: string | number;
  title: string;
  preview: string;
  duration: number;
  albumTitle: string;
  albumCover: string;
  link: string;
  source?: "deezer";
}

export interface ArtistRecommendation {
  setTime: SetTime;
  artist: {
    name: string;
    image: string;
    link: string;
    deezerId: number;
  } | null;
  topTracks: TrackInfo[];
}
