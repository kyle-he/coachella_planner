import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { InviteHero } from "./InviteHero";
import { getPartyByCode } from "@/lib/party-store";
import {
  buildPartyInviteUrl,
  getSiteUrl,
  normalizePartyCode,
} from "@/lib/party-invite";

const SHARE_IMAGE_PATH = "/coachella-share.jpg";

function inviteTitle(partyName: string): string {
  return `Join ${partyName}'s Coachella plan`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code: rawCode } = await params;
  const code = normalizePartyCode(rawCode);
  const party = await getPartyByCode(code);
  const title = party ? inviteTitle(party.name) : "Join a Coachella plan";
  const description = party
    ? `Open this invite to join "${party.name}"'s party and plan Coachella together.`
    : "Open this invite to join a party and plan Coachella together.";
  const url = buildPartyInviteUrl(code);

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: [SHARE_IMAGE_PATH],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SHARE_IMAGE_PATH],
    },
  };
}

export default async function JoinPartyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = normalizePartyCode(rawCode);
  const party = await getPartyByCode(code);
  const session = await auth();

  if (!party) {
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-12 pb-[max(3rem,calc(env(safe-area-inset-bottom,0px)+2rem))] pt-[max(3rem,calc(env(safe-area-inset-top,0px)+1.5rem))] text-center sm:px-10 sm:py-16 sm:pb-[max(4rem,calc(env(safe-area-inset-bottom,0px)+2.5rem))] sm:pt-[max(4rem,calc(env(safe-area-inset-top,0px)+2rem))]">
        <div className="noise-overlay" aria-hidden />
        <div className="grain-strong relative z-10 mx-auto w-full max-w-lg rounded-[2rem] border border-border/40 bg-[color-mix(in_srgb,var(--background)_82%,transparent)] px-8 py-10 shadow-[0_24px_70px_rgba(0,0,0,0.24)] backdrop-blur-md sm:px-10 sm:py-12">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-cyan/80">
            Invite Not Found
          </p>
          <h1 className="mt-4 font-nineties text-[clamp(2rem,5vw,3.75rem)] leading-[0.96] tracking-[0.05em] text-cyan">
            This party link expired
          </h1>
          <p className="mt-5 text-[15px] leading-7 text-muted">
            Ask your friend to send a fresh invite from their Coachella plan.
          </p>
          <a
            href={getSiteUrl()}
            className="scratch-pill mt-8 inline-flex items-center justify-center px-5 py-3 text-sm font-semibold bg-accent text-on-accent transition-colors hover:bg-[var(--accent-hover-soft)]"
          >
            Back to Coachella Planner
          </a>
        </div>
      </main>
    );
  }

  if (session?.user) {
    redirect(`/profile?join=${encodeURIComponent(code)}`);
  }

  return <InviteHero code={code} partyName={party.name} />;
}
