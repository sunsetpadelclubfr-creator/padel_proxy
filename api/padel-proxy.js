// api/padel-proxy.js
import { get } from "@vercel/blob";

export default async function handler(req, res) {
  const { date = "", dept = "", category = "", type = "" } = req.query;

  try {
    // 1. Lire le JSON depuis le Blob
    let tournaments = [];

    try {
      const blob = await get("padel-cache/tournaments.json");
      if (!blob || !blob.url) {
        throw new Error("Blob tournaments.json not found");
      }

      const resp = await fetch(blob.url);
      if (!resp.ok) {
        throw new Error(`Blob HTTP ${resp.status}`);
      }

      tournaments = await resp.json();
    } catch (blobErr) {
      console.error("Error reading blob cache:", blobErr);
      // Si le cache n’existe pas, on renvoie liste vide
      tournaments = [];
    }

    // 2. Filtres
    const filtered = tournaments.filter((t) => {
      // sécurité
      if (!t || !t.tournament || !t.club) return false;

      if (date && t.tournament.startDate !== date) return false;

      if (dept) {
        const wanted = dept.split(",").map((d) => d.trim());
        if (!wanted.includes(t.club.department)) return false;
      }

      if (category) {
        const wanted = category.split(",").map((c) => c.trim().toUpperCase());
        if (!wanted.includes((t.tournament.category || "").toUpperCase()))
          return false;
      }

      if (type) {
        const wanted = type.split(",").map((x) => x.trim().toUpperCase());
        if (!wanted.includes((t.tournament.type || "").toUpperCase()))
          return false;
      }

      return true;
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(filtered);
  } catch (err) {
    console.error("padel-proxy ERROR:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ ok: false, error: err.message });
  }
}
