"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

const MESSAGES: Record<string, string> = {
  auth_failed:
    "Spotify sign-in was cancelled or did not return a code. Try connecting again.",
  oauth_state:
    "The Spotify login handshake expired or did not match this browser tab. Try connecting again.",
  token_failed:
    "Could not exchange the login code with Spotify. Confirm the redirect URI in the Spotify dashboard exactly matches the host you are using in the browser, and keep `localhost` vs `127.0.0.1` consistent.",
  token_incomplete:
    "Spotify returned tokens without a refresh token. Revoke this app in your Spotify account settings and try signing in again.",
  insufficient_scope:
    "This Spotify session does not have the required listening-history permissions. Connect again and approve the requested scopes.",
  spotify_user_data_forbidden:
    "Spotify accepted the sign-in, but then blocked the listening-history endpoints this app needs. If the Spotify app is still in Development Mode, add this Spotify account under Users and Access in the Spotify dashboard, then reconnect.",
  spotify_access_denied:
    "Spotify blocked this saved session from reading your listening data. Fully reconnect your account, and if it still fails, check the Spotify app's Users and Access list in the developer dashboard.",
  missing_tokens:
    "That login link was incomplete. Use Connect with Spotify from the home page.",
  oauth_config:
    "Server is missing Spotify client configuration (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET).",
  reauth_required:
    "Your saved Spotify session is outdated or missing required permissions. Connect again to refresh it.",
  session_upgrade_required:
    "Your saved Spotify session is from an older auth flow. Connect again to refresh it.",
};

export function AuthErrorBanner() {
  const searchParams = useSearchParams();
  const code = searchParams.get("error");
  if (!code) return null;

  const message = MESSAGES[code] ?? "Something went wrong during sign-in.";

  return (
    <div
      className="grain-strong relative z-10 border-b border-dashed border-border/70 bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-8 py-4 sm:px-12 lg:px-16"
      role="alert"
    >
      <div className="mx-auto max-w-2xl text-center sm:text-left">
        <p className="text-sm font-medium text-foreground">Sign-in issue</p>
        <p className="mt-1 text-[13px] leading-snug text-muted">{message}</p>
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
