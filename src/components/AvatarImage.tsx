"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useState } from "react";

function isRemoteHttpUrl(src: string) {
  return /^https?:\/\//i.test(src);
}

export type AvatarImageProps = {
  src: string;
  alt: string;
  /** Used for the letter fallback while the image loads (or if it fails). */
  name?: string;
  /** Tailwind size classes, e.g. `h-7 w-7` — required so layout never jumps. */
  className: string;
  /** Passed to next/image when using remote URLs. */
  sizes?: string;
  /** Fetch sooner for above-the-fold avatars (e.g. schedule header). */
  priority?: boolean;
  /** e.g. `ring-1 ring-border/40` */
  ringClassName?: string;
  /** Use schedule “scratch” shape for artist tiles instead of a circle. */
  variant?: "circle" | "blob";
  /** Letter fallback sizing; tune per avatar size. */
  fallbackClassName?: string;
  style?: CSSProperties;
};

/**
 * Avatar with reserved box + initial fallback, then a short crossfade when the
 * image finishes loading so remote PFPs do not “pop” in.
 */
export function AvatarImage({
  src,
  alt,
  name,
  className,
  sizes = "40px",
  priority = false,
  ringClassName,
  variant = "circle",
  fallbackClassName = "text-[10px] font-bold text-muted/50",
  style,
}: AvatarImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const initial = (name || alt || "?").trim().charAt(0).toUpperCase() || "?";
  const shape =
    variant === "blob" ? "scratch-blob" : "rounded-full";
  const remote = isRemoteHttpUrl(src);
  const showPhoto = remote ? !failed && src.length > 0 : !failed && src.length > 0;

  return (
    <span
      style={style}
      className={`relative inline-block shrink-0 overflow-hidden bg-[var(--hover-wash-strong)] ${shape} ${ringClassName ?? ""} ${className}`}
    >
      <span
        className={`pointer-events-none absolute inset-0 flex items-center justify-center select-none ${fallbackClassName}`}
        aria-hidden
      >
        {initial}
      </span>
      {showPhoto &&
        (remote ? (
          <Image
            src={src}
            alt={alt}
            fill
            sizes={sizes}
            className={`object-cover transition-opacity duration-200 ease-out ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            priority={priority}
            referrerPolicy="no-referrer"
          />
        ) : (
          // data: / blob: URLs (e.g. cropped profile photo)
          <img
            src={src}
            alt={alt}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ease-out ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            decoding="async"
            fetchPriority={priority ? "high" : "auto"}
          />
        ))}
    </span>
  );
}
