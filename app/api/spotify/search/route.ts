// GET /api/spotify/search?q=...&limit=10

import { searchTracks, enrichTracks } from "@/lib/spotify";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "10", 10);

  if (!q) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }

  try {
    const tracks = await searchTracks(q, limit);
    const enriched = await enrichTracks(tracks);
    return NextResponse.json({ tracks: enriched });
  } catch (error) {
    console.error("Spotify search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Spotify error" },
      { status: 500 }
    );
  }
}
