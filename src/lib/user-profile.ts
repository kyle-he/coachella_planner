import { getDoc, runQuery, setDoc, updateDoc } from "@/lib/firestore-rest";

export interface UserProfileOverride {
  name: string;
  image: string;
  updatedAt: number;
}

export async function getUserProfileOverride(
  email: string
): Promise<UserProfileOverride | null> {
  const data = await getDoc(`userProfiles/${email}`);
  if (!data) return null;
  return {
    name: String(data.name ?? ""),
    image: String(data.image ?? ""),
    updatedAt: Number(data.updatedAt ?? 0),
  };
}

export async function upsertUserProfileOverride(
  email: string,
  profile: { name: string; image: string }
): Promise<UserProfileOverride> {
  const payload: UserProfileOverride = {
    name: profile.name.trim(),
    image: profile.image.trim(),
    updatedAt: Date.now(),
  };
  await setDoc(`userProfiles/${email}`, {
    name: payload.name,
    image: payload.image,
    updatedAt: payload.updatedAt,
  });

  // Keep party member snapshots in sync so avatar/name updates are visible
  // across schedule stacks and member lists without waiting for re-joins.
  const membershipDocs = await runQuery({
    collection: "members",
    allDescendants: true,
    filters: [{ field: "email", op: "EQUAL", value: email }],
  });
  const updates = membershipDocs.map((doc) =>
    updateDoc(doc.path, {
      name: payload.name,
      image: payload.image,
    })
  );
  const results = await Promise.allSettled(updates);
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[profile] Failed to update ${failed} party member profile(s)`);
  }

  return payload;
}
