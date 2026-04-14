import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LandingHero } from "./LandingHero";
import { AuthErrorBanner } from "./AuthErrorBanner";
import { AuthSessionReset } from "./AuthSessionReset";

export default async function Home({
  params,
  searchParams,
}: {
  params?: Promise<Record<string, string | string[]>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await Promise.all([
    params ?? Promise.resolve({}),
    searchParams ?? Promise.resolve({}),
  ]);

  const session = await auth();
  if (session?.user) redirect("/schedule");

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="noise-overlay" aria-hidden />

      <Suspense fallback={null}>
        <AuthSessionReset />
        <AuthErrorBanner />
      </Suspense>

      <LandingHero />

      <footer className="grain-strong relative z-10 border-t border-border/40 px-8 py-6 sm:px-12 lg:px-16">
        <p className="max-w-2xl mx-auto text-center text-[12px] text-muted/50">
          Made with ❤️ by{" "}
          <a
            href="https://kylehe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted/70 underline decoration-dotted underline-offset-2 hover:text-foreground transition-colors"
          >
            Kyle He
          </a>
        </p>
      </footer>
    </main>
  );
}
