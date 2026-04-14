"use client";

import Image from "next/image";
import { signIn } from "next-auth/react";
import { useState } from "react";

const TITLE = "Plan an awesome Coachella with your friends";

export function LandingHero() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="grain-strong relative z-10 flex flex-1 flex-col justify-center px-8 py-16 sm:px-12 sm:py-20 lg:px-16">
      <div className="mx-auto flex w-fit max-w-full flex-col items-center gap-8 sm:flex-row sm:items-center sm:justify-center sm:gap-10 lg:gap-14">
        <div className="order-1 flex min-w-0 flex-col items-center text-center sm:order-2">
          <h1 className="max-w-xl font-nineties text-[clamp(2.35rem,6.2vw,4.75rem)] font-bold leading-[0.95] tracking-[0.045em] text-cyan text-balance lg:max-w-3xl">
            {TITLE}
          </h1>
          <div className="mt-10 w-full max-w-xs sm:max-w-sm">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                signIn("google", { redirectTo: "/schedule" });
              }}
              className="scratch-pill w-full inline-flex items-center justify-center gap-3 px-6 py-3.5 bg-accent text-on-accent text-sm font-semibold tracking-wide transition-colors hover:bg-[var(--accent-hover-soft)] active:scale-[0.98] shadow-[3px_3px_0_color-mix(in_srgb,var(--teal)_28%,transparent)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              )}
              {loading ? "Signing in…" : "Sign in with Google"}
            </button>
            <p className="mt-4 text-[12px] text-muted/60 leading-relaxed">
              We only use your name and profile picture.
            </p>
          </div>
        </div>
        <div className="order-2 w-full max-w-[min(92vw,400px)] shrink-0 sm:order-1 sm:max-w-[380px] lg:max-w-[440px]">
          <Image
            src="/coachella-poster.jpg"
            alt="Coachella 2026 festival poster"
            width={720}
            height={1008}
            className="h-auto w-full rounded-md object-cover shadow-[6px_6px_0_color-mix(in_srgb,var(--teal)_18%,transparent)]"
            priority
          />
        </div>
      </div>
    </div>
  );
}
