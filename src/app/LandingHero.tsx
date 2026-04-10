import Image from "next/image";

const TITLE = "Plan an awesome Coachella with your listening history";

export function LandingHero({ authHref }: { authHref: string }) {
  return (
    <div className="grain-strong relative z-10 px-8 pt-16 pb-24 sm:px-12 sm:pt-24 sm:pb-32 lg:px-16">
      <div className="mx-auto flex w-fit max-w-full flex-col items-center gap-8 sm:flex-row sm:items-start sm:justify-center sm:gap-10 lg:gap-14">
        <div className="w-full max-w-[min(92vw,400px)] shrink-0 sm:max-w-[380px] lg:max-w-[440px]">
          <Image
            src="/coachella-poster.jpg"
            alt="Coachella 2026 festival poster"
            width={720}
            height={1008}
            className="h-auto w-full rounded-md object-cover shadow-[6px_6px_0_color-mix(in_srgb,var(--teal)_18%,transparent)]"
            priority
          />
        </div>
        <div className="flex min-w-0 flex-col items-center text-center sm:items-start sm:text-left">
          <h1 className="max-w-xl font-nineties text-[clamp(2.35rem,6.2vw,4.75rem)] font-bold leading-[0.95] tracking-[0.045em] text-cyan lg:max-w-3xl">
            {TITLE}
          </h1>
          <a
            href={authHref}
            className="mt-10 scratch-pill group inline-flex items-center gap-3 px-7 py-3.5 bg-accent text-on-accent text-sm font-semibold tracking-wide transition-colors hover:bg-[var(--accent-hover-soft)] active:scale-[0.98] shadow-[3px_3px_0_color-mix(in_srgb,var(--teal)_28%,transparent)]"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            Connect with Spotify
          </a>
          <p className="mt-4 max-w-xs text-center text-[11px] text-muted/60 sm:text-left">
            Read-only access to your top artists and tracks. Nothing is stored
            or shared.
          </p>
        </div>
      </div>
    </div>
  );
}
