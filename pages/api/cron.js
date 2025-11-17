// pages/api/cron.js

export default async function handler(req, res) {
  // URL de base de ton projet déployé
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || "https://padel-proxy.vercel.app";

  try {
    // On prend la date du jour (format YYYY-MM-DD)
    const today = new Date().toISOString().slice(0, 10);

    // On appelle ton proxy en forçant un refresh du cache
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
