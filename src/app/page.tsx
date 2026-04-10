import { Suspense } from "react";
import { LandingHero } from "./LandingHero";
import { AuthErrorBanner } from "./AuthErrorBanner";
import { AuthSessionReset } from "./AuthSessionReset";

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <div className="noise-overlay" aria-hidden />

      <Suspense fallback={null}>
        <AuthSessionReset />
        <AuthErrorBanner />
      </Suspense>

      <LandingHero />

      {/* Stats strip */}
      <div className="grain-strong relative z-10 border-t border-dashed border-border/70 px-8 sm:px-12 lg:px-16">
        <div className="max-w-2xl mx-auto grid grid-cols-3">
          <div className="border-r border-dashed border-border/60 px-6 py-6 text-center -rotate-1">
            <div className="font-display text-2xl font-bold text-cyan">137</div>
            <div className="text-[11px] text-muted mt-1 tracking-wide uppercase">
              Artists
            </div>
          </div>
          <div className="border-r border-dashed border-border/60 px-6 py-6 text-center rotate-1">
            <div className="font-display text-2xl font-bold text-cyan">7</div>
            <div className="text-[11px] text-muted mt-1 tracking-wide uppercase">
              Stages
            </div>
          </div>
          <div className="px-6 py-6 text-center -rotate-1">
            <div className="font-display text-2xl font-bold text-cyan">3</div>
            <div className="text-[11px] text-muted mt-1 tracking-wide uppercase">
              Days
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="grain-strong relative z-10 border-t border-dashed border-border/70 px-8 py-6 sm:px-12 lg:px-16">
        <div className="max-w-2xl mx-auto flex items-center justify-between text-[11px] text-muted/50">
          <span>Coachella Planner 2026</span>
          <span>Not affiliated with Goldenvoice</span>
        </div>
      </footer>
    </main>
  );
}
