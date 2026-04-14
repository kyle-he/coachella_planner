import { getDoc, setDoc } from "./firestore-rest";

export interface UserPlanData {
  plan: Partial<Record<string, string[]>>;
  updatedAt: number;
}

export async function getUserPlan(email: string): Promise<UserPlanData | null> {
  const data = await getDoc(`userPlans/${email}`);
  if (!data) return null;
  const plan = (data.plan as Partial<Record<string, string[]>>) ?? {};
  const updatedAt = Number(data.updatedAt ?? 0);
  return { plan, updatedAt };
}

export async function setUserPlan(
  email: string,
  plan: Partial<Record<string, string[]>>
): Promise<UserPlanData> {
  const updatedAt = Date.now();
  await setDoc(`userPlans/${email}`, { plan, updatedAt });
  return { plan, updatedAt };
}
