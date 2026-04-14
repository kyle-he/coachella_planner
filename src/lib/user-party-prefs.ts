import { getDoc, setDoc } from "@/lib/firestore-rest";

function normalizePartyScheduleVisible(
  raw: unknown
): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
    else if (v === "true") out[k] = true;
    else if (v === "false") out[k] = false;
  }
  return out;
}

/** Per-party preference: whether to show that party's members on the schedule (default true). */
export async function getPartyScheduleVisibility(
  email: string
): Promise<Record<string, boolean>> {
  const data = await getDoc(`userPartyPrefs/${email}`);
  return normalizePartyScheduleVisible(data?.partyScheduleVisible);
}

export async function setPartyScheduleVisibility(
  email: string,
  partyId: string,
  visible: boolean
): Promise<Record<string, boolean>> {
  const current = await getPartyScheduleVisibility(email);
  const next = { ...current, [partyId]: visible };
  await setDoc(`userPartyPrefs/${email}`, { partyScheduleVisible: next });
  return next;
}

export async function removePartyFromSchedulePrefs(
  email: string,
  partyId: string
): Promise<void> {
  const current = await getPartyScheduleVisibility(email);
  if (!(partyId in current)) return;
  const next = { ...current };
  delete next[partyId];
  await setDoc(`userPartyPrefs/${email}`, { partyScheduleVisible: next });
}
