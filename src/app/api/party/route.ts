import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserProfileOverride } from "@/lib/user-profile";
import {
  createParty,
  getPartiesForUser,
  getPartyByCode,
  joinParty,
  leaveParty,
  syncPlan,
} from "@/lib/party-store";
import {
  getPartyScheduleVisibility,
  removePartyFromSchedulePrefs,
  setPartyScheduleVisibility,
} from "@/lib/user-party-prefs";

async function getUser() {
  const session = await auth();
  if (!session?.user?.email) return null;
  const override = await getUserProfileOverride(session.user.email);
  return {
    email: session.user.email,
    name: override?.name || session.user.name || "",
    image: override?.image || session.user.image || "",
  };
}

async function partyPayload(user: { email: string; name: string; image: string }) {
  const [parties, schedulePartyVisible] = await Promise.all([
    getPartiesForUser(user.email),
    getPartyScheduleVisibility(user.email),
  ]);

  const memberEmails = new Set<string>();
  for (const party of parties) {
    for (const member of party.members) {
      memberEmails.add(member.email);
    }
  }

  const overrides = new Map<string, { name: string; image: string }>();
  await Promise.all(
    [...memberEmails].map(async (email) => {
      const override = await getUserProfileOverride(email);
      if (!override) return;
      overrides.set(email, { name: override.name, image: override.image });
    })
  );

  const partiesWithFreshProfiles = parties.map((party) => ({
    ...party,
    members: party.members.map((member) => {
      const override = overrides.get(member.email);
      if (!override) return member;
      return {
        ...member,
        name: override.name || member.name,
        image: override.image || member.image,
      };
    }),
  }));

  return { parties: partiesWithFreshProfiles, schedulePartyVisible };
}

// GET — current user's parties + schedule visibility prefs
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await partyPayload(user));
}

// POST — create, join, leave, sync, or setScheduleVisibility
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    action:
      | "create"
      | "join"
      | "leave"
      | "sync"
      | "setScheduleVisibility";
    name?: string;
    code?: string;
    partyId?: string;
    plan?: Partial<Record<string, string[]>>;
    visible?: boolean;
  };

  switch (body.action) {
    case "create": {
      const partyName = (body.name || "").trim() || `${user.name}'s Party`;
      await createParty(partyName, user);
      return NextResponse.json(await partyPayload(user));
    }

    case "join": {
      const code = (body.code || "").trim().toUpperCase();
      if (!code) {
        return NextResponse.json({ error: "Party code is required" }, { status: 400 });
      }
      const found = await getPartyByCode(code);
      if (!found) {
        return NextResponse.json({ error: "Party not found" }, { status: 404 });
      }
      await joinParty(code, user);
      return NextResponse.json(await partyPayload(user));
    }

    case "leave": {
      const partyId = body.partyId;
      if (!partyId) {
        return NextResponse.json({ error: "partyId is required" }, { status: 400 });
      }
      await leaveParty(partyId, user.email);
      await removePartyFromSchedulePrefs(user.email, partyId);
      return NextResponse.json(await partyPayload(user));
    }

    case "sync": {
      const partyId = body.partyId;
      const plan = body.plan;
      if (!partyId || !plan) {
        return NextResponse.json({ error: "partyId and plan are required" }, { status: 400 });
      }
      await syncPlan(partyId, user.email, plan);
      return NextResponse.json(await partyPayload(user));
    }

    case "setScheduleVisibility": {
      const partyId = body.partyId;
      const visible = body.visible;
      if (!partyId || typeof visible !== "boolean") {
        return NextResponse.json(
          { error: "partyId and visible (boolean) are required" },
          { status: 400 }
        );
      }
      const memberParties = await getPartiesForUser(user.email);
      if (!memberParties.some((p) => p.id === partyId)) {
        return NextResponse.json({ error: "Not a member of that party" }, { status: 403 });
      }
      const schedulePartyVisible = await setPartyScheduleVisibility(
        user.email,
        partyId,
        visible
      );
      const parties = await getPartiesForUser(user.email);
      return NextResponse.json({ parties, schedulePartyVisible });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
