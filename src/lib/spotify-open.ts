/**
 * Opens Spotify search for an artist name (no API; works for open.spotify.com).
 */
export function spotifyArtistSearchUrl(artistName: string): string {
  const q = artistName.trim();
  if (!q) return "https://open.spotify.com/search";
  return `https://open.spotify.com/search/${encodeURIComponent(q)}`;
}
