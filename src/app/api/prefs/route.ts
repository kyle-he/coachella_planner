import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserPrefs, setUserPrefs } from "@/lib/user-prefs-store";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await getUserPrefs(session.user.email);
  return NextResponse.json({
    showPopularSongs: data?.showPopularSongs ?? null,
    updatedAt: data?.updatedAt ?? 0,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    showPopularSongs?: boolean;
  };

  const data = await setUserPrefs(session.user.email, {
    ...(typeof body.showPopularSongs === "boolean"
      ? { showPopularSongs: body.showPopularSongs }
      : {}),
  });

  return NextResponse.json({
    showPopularSongs: data.showPopularSongs ?? null,
    updatedAt: data.updatedAt,
  });
}
