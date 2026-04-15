import { NextRequest, NextResponse } from "next/server";

/**
 * Returns a fresh Deezer 30s preview URL for a track id.
 * Client uses this when a cached/stale preview URL fails (signed URLs expire).
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid track id" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://api.deezer.com/track/${id}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { preview: null, error: "upstream" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      preview?: string;
      error?: { message?: string };
    };

    if (data.error) {
      return NextResponse.json({ preview: null });
    }

    const preview =
      typeof data.preview === "string" && /^https?:\/\//i.test(data.preview)
        ? data.preview
        : null;

    return NextResponse.json({ preview });
  } catch (e) {
    console.warn("[track-preview]", e);
    return NextResponse.json(
      { preview: null, error: "network" },
      { status: 503 }
    );
  }
}
