"use client";

import Image from "next/image";
import { signIn } from "next-auth/react";
import { useState } from "react";

const MOBILE_HERO = "/invite-hero-mobile.webp";

function InviteCopy({
  partyName,
  loading,
  onJoin,
  className,
  showPalmDecor = false,
}: {
  partyName: string;
  loading: boolean;
  onJoin: () => void;
  className: string;
  showPalmDecor?: boolean;
}) {
  return (
    <div className={className}>
      {showPalmDecor ? (
        <p
          className="mb-3 text-center text-[2.35rem] leading-none tracking-normal"
          aria-hidden
        >
          🌴
        </p>
      ) : null}
      <h1 className="font-nineties text-[clamp(2.05rem,4.8vw,4.25rem)] leading-[0.96] tracking-[0.045em] text-balance text-cyan md:text-[clamp(2.3rem,5vw,4.6rem)] md:leading-[0.95] md:tracking-[0.05em]">
        Join {partyName}
        {"'"}s Coachella plan
      </h1>
      <p className="mx-auto mt-5 max-w-lg text-base font-medium leading-relaxed text-foreground/82 md:mx-0 md:max-w-none md:text-base md:font-normal md:leading-7 md:text-muted">
        Join the party and see where everyone is headed!
      </p>

      <div className="mt-9 flex w-full justify-center pb-12 md:justify-start md:pb-0">
        <button
          type="button"
          disabled={loading}
          onClick={onJoin}
          className="scratch-pill inline-flex items-center justify-center gap-3 px-6 py-3.5 bg-accent text-on-accent text-[15px] font-semibold tracking-wide transition-colors hover:bg-[var(--accent-hover-soft)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        >
          {loading ? (
            <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24">
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
      </div>
    </div>
  );
}

export function InviteHero({
  code,
  partyName,
}: {
  code: string;
  partyName: string;
}) {
  const [loading, setLoading] = useState(false);

  const onJoin = () => {
    setLoading(true);
    signIn("google", { redirectTo: `/join/${code}` });
  };

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="noise-overlay" aria-hidden />

      <div className="relative z-[60] flex min-h-dvh flex-1 flex-col">
        {/* Mobile: image layer only above the sheet; object-bottom anchors photo bottom to sheet top (not viewport bottom) */}
        <div className="relative isolate min-h-dvh flex-1 md:hidden">
          <div className="relative z-10 flex min-h-dvh flex-col">
            <div className="relative z-0 min-h-0 flex-1 -mb-[5dvh]">
              <div className="pointer-events-none absolute inset-0">
                <Image
                  src={MOBILE_HERO}
                  alt="Desert sunrise over the festival horizon"
                  fill
                  priority
                  sizes="100vw"
                  className="object-cover object-bottom"
                />
              </div>
            </div>
            {/* Solid panel = bottom 80% of a 50dvh popup (40dvh); top ~10dvh above is image-only band */}
            <div className="grain-strong relative z-10 flex min-h-[40dvh] w-full shrink-0 flex-col justify-center overflow-hidden rounded-t-[1.75rem] border-t border-border/40 bg-background px-6 pt-8 shadow-[0_-12px_44px_rgba(0,0,0,0.22)] sm:px-8 sm:pt-9 pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))]">
              <InviteCopy
                partyName={partyName}
                loading={loading}
                onJoin={onJoin}
                showPalmDecor
                className="mx-auto flex w-full max-w-xl flex-col items-center text-center"
              />
            </div>
          </div>
        </div>

        {/* Tablet / desktop: existing card + landscape art */}
        <div className="grain-strong relative hidden min-h-dvh flex-1 flex-col items-center justify-center px-10 py-16 pb-[max(4rem,calc(env(safe-area-inset-bottom,0px)+2.5rem))] pt-[max(4rem,calc(env(safe-area-inset-top,0px)+2rem))] md:flex">
          <div className="mx-auto flex w-full max-w-5xl flex-row items-stretch gap-12 overflow-hidden rounded-[2rem] border border-border/40 bg-[color-mix(in_srgb,var(--background)_78%,transparent)] p-11 shadow-[0_24px_70px_rgba(0,0,0,0.24)] backdrop-blur-md">
            <div className="aspect-[1015/768] w-full max-w-[min(92vw,420px)] shrink-0 overflow-hidden rounded-[1.5rem] border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
              <Image
                src="/coachella-share.jpg"
                alt="Sunset mountain view at Coachella"
                width={1015}
                height={768}
                className="h-full w-full object-cover"
                sizes="(min-width: 768px) 420px, 0px"
              />
            </div>

            <InviteCopy
              partyName={partyName}
              loading={loading}
              onJoin={onJoin}
              className="flex min-w-0 max-w-xl flex-1 flex-col justify-center md:max-w-none md:items-start md:text-left"
            />
          </div>
        </div>
      </div>
    </main>
  );
}
