import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev: keep a single local origin so Spotify redirect + cookies stay aligned.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
      { protocol: "https", hostname: "wrapped-images.spotifycdn.com" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
      { protocol: "https", hostname: "api.deezer.com" },
      { protocol: "https", hostname: "cdnt-preview.dzcdn.net" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
