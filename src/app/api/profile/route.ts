import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getUserProfileOverride,
  upsertUserProfileOverride,
} from "@/lib/user-profile";

async function getAuthedUser() {
  const session = await auth();
  if (!session?.user?.email) return null;
  return {
    email: session.user.email,
    defaultName: session.user.name ?? "",
    defaultImage: session.user.image ?? "",
  };
}

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const override = await getUserProfileOverride(user.email);
  return NextResponse.json({
    profile: {
      name: override?.name || user.defaultName,
      image: override?.image || user.defaultImage,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { name?: string; image?: string };
  const name = (body.name ?? "").trim();
  const image = (body.image ?? "").trim();

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const saved = await upsertUserProfileOverride(user.email, { name, image });
  return NextResponse.json({
    profile: { name: saved.name, image: saved.image },
  });
}
