// app/api/cron/route.js

import { NextResponse } from "next/server";

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const URL =
    process.env.NEXT_PUBLIC_BASE_URL +
    `/api/padel-proxy?date=${today}&refresh=1`;

  try {
    const res = await fetch(URL);
    const data = await res.json();

    console.log("[CRON] Cache refreshed for date:", today, "count:", data.length);

    return NextResponse.json({
      ok: true,
      refreshedDate: today,
      tournaments: data.length,
    });
  } catch (e) {
    console.error("[CRON ERROR]", e);
    return NextResponse.json(
      {
        ok: false,
        error: String(e),
      },
      { status: 500 }
    );
  }
}
