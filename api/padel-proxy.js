// api/padel-proxy.js
import { get } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  const { date = "", dept = "", category = "", type = "" } = req.query;

  try {
    // 1. On lit le fichier JSON dans le Blob
    let tournaments = [];

    try {
      const blobInfo = await get("tournaments.json");
      const resp = await fetch(blobInfo.url);
      tournaments = await resp.json();
    } catch (err) {
      console.error("Erreur lecture Blob (tournaments.json):", err);
      // si erreur, on renvoie un tableau vide
      tournaments = [];
    }

    // 2. Filtres côté API pour gagner du temps côté mobile
    const filtered = tournaments.filter((t) => {
      if (!t || !t.tournament || !t.club) return false;

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

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(filtered);
  } catch (err) {
    console.error("padel-proxy error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "Proxy error", details: err.message });
  }
}
