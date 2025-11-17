// api/cron.js

export default async function handler(req, res) {
  // Sécurité simple : accepte seulement GET
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // On appelle simplement ton proxy pour remplir le cache
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://padel-proxy.vercel.app"; // fallback

    // Ici tu choisis les paramètres "par défaut" que tu veux pré-charger
    const url = `${baseUrl}/api/padel-proxy?date=&dept=&category=&type=`;

    const resp = await fetch(url);
    const data = await resp.json();

    console.log("Cron cache refresh done, tournaments:", data.length || 0);

    return res.status(200).json({
      ok: true,
      refreshed: true,
      count: data.length || 0,
    });
  } catch (e) {
    console.error("Cron error:", e);
    return res
      .status(500)
      .json({ ok: false, error: "Cron failed", details: e.message });
  }
}
