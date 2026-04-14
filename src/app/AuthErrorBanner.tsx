"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

const MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "This email is already linked to another sign-in method.",
  AccessDenied: "Access was denied. Please try again.",
  Verification: "The sign-in link has expired. Please try again.",
  Default: "Something went wrong during sign-in. Please try again.",
};

export function AuthErrorBanner() {
  const searchParams = useSearchParams();
  const code = searchParams.get("error");
  if (!code) return null;

  const message = MESSAGES[code] ?? MESSAGES.Default;

  return (
    <div
      className="grain-strong relative z-10 border-b border-border/50 bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-8 py-4 sm:px-12 lg:px-16"
      role="alert"
    >
      <div className="mx-auto max-w-2xl text-center sm:text-left">
        <p className="text-sm font-medium text-foreground">Sign-in issue</p>
        <p className="mt-1 text-[14px] leading-snug text-muted">{message}</p>
        <Link
          href="/"
          className="mt-3 inline-block text-xs font-semibold text-accent underline-offset-2 hover:underline"
          replace
        >
          Dismiss
        </Link>
      </div>
    </div>
  );
}
