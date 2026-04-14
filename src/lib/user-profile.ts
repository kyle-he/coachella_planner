import { getDoc, setDoc } from "@/lib/firestore-rest";

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
  return payload;
}
