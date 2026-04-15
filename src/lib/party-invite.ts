const DEFAULT_SITE_URL = "http://127.0.0.1:3000";

export function normalizePartyCode(code: string): string {
  return code.trim().toUpperCase();
}

export function buildPartyInvitePath(code: string): string {
  return `/join/${encodeURIComponent(normalizePartyCode(code))}`;
}

export function getSiteUrl(): string {
  const candidate =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;

  if (!candidate) return DEFAULT_SITE_URL;

  const withProtocol = /^https?:\/\//.test(candidate)
    ? candidate
    : `https://${candidate}`;

  return withProtocol.replace(/\/$/, "");
}

export function buildPartyInviteUrl(code: string): string {
  return new URL(buildPartyInvitePath(code), getSiteUrl()).toString();
}
