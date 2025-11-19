// api/padel-proxy.js

// ⚠️ À adapter avec TA base URL (Store Information > Base URL)
const BLOB_BASE_URL =
  "https://q2tzmq60pef1lix1.public.blob.vercel-storage.com";
const CACHE_KEY = "padel-cache/tournaments.json";

// petit cache mémoire (quelques minutes) pour limiter les lectures blob
let MEMORY_CACHE = null;
let MEMORY_TIME = 0;
const MEMORY_DURATION = 5 * 60 * 1000; // 5 minutes

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { date = "", dept = "", category = "", type = "" } = req.query || {};

  try {
    let tournaments = MEMORY_CACHE;

    // recharge depuis le blob si pas de cache mémoire ou expiré
    if (!tournaments || Date.now() - MEMORY_TIME > MEMORY_DURATION) {
      const url = `${BLOB_BASE_URL}/${CACHE_KEY}`;
      const resp = await fetch(url);

      if (!resp.ok) {
        console.error("Erreur lecture blob:", resp.status);
        return res
          .status(500)
          .json({ error: "Impossible de lire le cache" });
      }

      tournaments = await resp.json();
      MEMORY_CACHE = tournaments;
      MEMORY_TIME = Date.now();
    }

    // --- filtres ---
    const filtered = tournaments.filter((t) => {
      if (date && t.tournament.startDate !== date) return false;

      if (dept) {
        const wanted = dept.split(",").map((s) => s.trim());
        if (!wanted.includes(t.club.department)) return false;
      }

      if (category) {
        const wanted = category.split(",").map((s) => s.trim().toUpperCase());
        if (!wanted.includes(t.tournament.category)) return false;
      }

      if (type) {
        const wanted = type.split(",").map((s) => s.trim().toUpperCase());
        if (!wanted.includes((t.tournament.type || "").toUpperCase()))
          return false;
      }

      return true;
    });

    return res.status(200).json(filtered);
  } catch (err) {
    console.error("padel-proxy error:", err);
    return res.status(500).json({
      error: "padel-proxy failed",
      message: err.message,
    });
  }
}
