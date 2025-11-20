import { get } from "@vercel/blob";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  const { date = "", dept = "", category = "", type = "" } = req.query;

  try {
    // Charger le fichier JSON du Blob
    const blob = await get("padel-cache.json");
    const jsonText = await blob.text();
    const tournaments = JSON.parse(jsonText);

    // Filtres ultra rapides
    const filtered = tournaments.filter((t) => {
      if (date && t.tournament.startDate !== date) return false;

      if (dept) {
        const wanted = dept.split(",");
        if (!wanted.includes(t.club.department)) return false;
      }

      if (category) {
        const wanted = category.split(",");
        if (!wanted.includes(t.tournament.category)) return false;
      }

      if (type) {
        const wanted = type.split(",");
        if (!wanted.includes(t.tournament.type)) return false;
      }

      return true;
    });

    return res.status(200).json(filtered);
  } catch (err) {
    console.error("padel-proxy error:", err);
    return res.status(500).json({ error: "Failed to read cache", details: err.message });
  }
}

