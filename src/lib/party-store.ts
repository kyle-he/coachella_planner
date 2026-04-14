import crypto from "node:crypto";
import {
  setDoc,
  getDoc,
  deleteDoc,
  updateDoc,
  listDocs,
  runQuery,
} from "./firestore-rest";

export interface PartyMember {
  email: string;
  name: string;
  image: string;
  /** recIdentityKey[] per day */
  plan: Partial<Record<string, string[]>>;
  joinedAt: number;
}

export interface Party {
  id: string;
  code: string;
  name: string;
  createdBy: string;
  createdAt: number;
  members: PartyMember[];
}

function generateCode(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

async function hydrateParty(
  partyId: string,
  data: Record<string, unknown>
): Promise<Party> {
  const memberDocs = await listDocs(`parties/${partyId}/members`);

  const members: PartyMember[] = memberDocs
    .map((d) => ({
      email: (d.data.email as string) ?? d.id,
      name: (d.data.name as string) ?? "",
      image: (d.data.image as string) ?? "",
      plan: (d.data.plan as Partial<Record<string, string[]>>) ?? {},
      joinedAt: (d.data.joinedAt as number) ?? 0,
    }))
    .sort((a, b) => a.joinedAt - b.joinedAt);

  return {
    id: partyId,
    code: data.code as string,
    name: data.name as string,
    createdBy: data.createdBy as string,
    createdAt: data.createdAt as number,
    members,
  };
}

export async function createParty(
  name: string,
  user: { email: string; name: string; image: string }
): Promise<Party> {
  const id = crypto.randomUUID();
  const code = generateCode();
  const now = Date.now();

  const partyData = { code, name, createdBy: user.email, createdAt: now };
  const memberData = {
    email: user.email,
    name: user.name,
    image: user.image,
    plan: {},
    joinedAt: now,
  };

  await setDoc(`parties/${id}`, partyData);
  await setDoc(`parties/${id}/members/${user.email}`, memberData);

  return { id, ...partyData, members: [memberData] };
}

export async function getPartyByCode(code: string): Promise<Party | null> {
  const results = await runQuery({
    collection: "parties",
    filters: [{ field: "code", op: "EQUAL", value: code }],
    limit: 1,
  });
  if (results.length === 0) return null;
  const hit = results[0];
  return hydrateParty(hit.id, hit.data);
}

export async function getPartyById(id: string): Promise<Party | null> {
  const data = await getDoc(`parties/${id}`);
  if (!data) return null;
  return hydrateParty(id, data);
}

/** All parties the user is a member of (sorted by creation time). */
export async function getPartiesForUser(email: string): Promise<Party[]> {
  const results = await runQuery({
    collection: "members",
    allDescendants: true,
    filters: [{ field: "email", op: "EQUAL", value: email }],
  });

  const seen = new Set<string>();
  const parties: Party[] = [];

  for (const hit of results) {
    const segments = hit.path.split("/");
    const partyId = segments[1];
    if (!partyId || seen.has(partyId)) continue;
    seen.add(partyId);
    const partyData = await getDoc(`parties/${partyId}`);
    if (!partyData) continue;
    parties.push(await hydrateParty(partyId, partyData));
  }

  return parties.sort((a, b) => a.createdAt - b.createdAt);
}

export async function joinParty(
  code: string,
  user: { email: string; name: string; image: string }
): Promise<Party | null> {
  const party = await getPartyByCode(code);
  if (!party) return null;
  if (party.members.some((m) => m.email === user.email)) return party;

  const now = Date.now();
  const memberData = {
    email: user.email,
    name: user.name,
    image: user.image,
    plan: {},
    joinedAt: now,
  };

  await setDoc(`parties/${party.id}/members/${user.email}`, memberData);
  party.members.push(memberData);
  return party;
}

export async function leaveParty(
  partyId: string,
  email: string
): Promise<boolean> {
  const partyData = await getDoc(`parties/${partyId}`);
  if (!partyData) return false;

  await deleteDoc(`parties/${partyId}/members/${email}`);

  const remaining = await listDocs(`parties/${partyId}/members`);
  if (remaining.length === 0) {
    await deleteDoc(`parties/${partyId}`);
  }

  return true;
}

export async function syncPlan(
  partyId: string,
  email: string,
  plan: Partial<Record<string, string[]>>
): Promise<boolean> {
  const memberData = await getDoc(`parties/${partyId}/members/${email}`);
  if (!memberData) return false;

  await updateDoc(`parties/${partyId}/members/${email}`, { plan });
  return true;
}
