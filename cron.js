// api/cron.js  (même niveau que api/padel-proxy.js)

export default async function handler(req, res) {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || "https://padel-proxy.vercel.app";

  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `${baseUrl}/api/padel-proxy?date=${today}&refresh=1`;

    const upstream = await fetch(url);

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("Cron refresh error:", upstream.status, text);
      return res.status(500).json({ ok: false, error: "Upstream error" });
    }

    const data = await upstream.json();

    return res.status(200).json({
      ok: true,
      refreshedDate: today,
      tournaments: Array.isArray(data) ? data.length : 0,
    });
  } catch (e) {
    console.error("Cron handler error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
