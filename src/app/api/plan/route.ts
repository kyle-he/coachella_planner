import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserPlan, setUserPlan } from "@/lib/user-plan-store";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await getUserPlan(session.user.email);
  return NextResponse.json({
    plan: data?.plan ?? {},
    updatedAt: data?.updatedAt ?? 0,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    plan?: Partial<Record<string, string[]>>;
  };

  if (!body.plan || typeof body.plan !== "object") {
    return NextResponse.json({ error: "plan is required" }, { status: 400 });
  }

  const data = await setUserPlan(session.user.email, body.plan);
  return NextResponse.json({ plan: data.plan, updatedAt: data.updatedAt });
}
