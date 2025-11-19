// api/padel-proxy.js

const BLOB_BASE_URL = process.env.BLOB_BASE_URL;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// Petit cache mémoire pour les appels rapprochés
let MEMORY_CACHE = null;
let MEMORY_TIME = 0;
const MEMORY_TTL = 1000 * 60 * 5; // 5 minutes

export default async function handler(req, res) {
  // CORS simple (si tu en as besoin côté app)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { date = "", dept = "", category = "", type = "" } = req.query;

  try {
    let tournaments = await loadFromMemoryOrBlob();

    // --- Filtres comme avant ---
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
    console.error("padel-proxy ERROR", err);
    return res.status(500).json({ error: "Erreur serveur", details: err.message });
  }
}

async function loadFromMemoryOrBlob() {
  const now = Date.now();
  if (MEMORY_CACHE && now - MEMORY_TIME < MEMORY_TTL) {
    return MEMORY_CACHE;
  }

  if (!BLOB_BASE_URL || !BLOB_TOKEN) {
    throw new Error("Configuration Blob manquante (BLOB_BASE_URL ou BLOB_READ_WRITE_TOKEN)");
  }

  const url = `${BLOB_BASE_URL}/tournaments.json`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BLOB_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (resp.status === 404) {
    throw new Error("Cache Blob introuvable. Lance /api/update-cache une première fois.");
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    console.error("Erreur GET Blob", resp.status, txt);
    throw new Error(`Erreur Blob ${resp.status}`);
  }

  const data = await resp.json();
  const list = Array.isArray(data.tournaments) ? data.tournaments : [];

  MEMORY_CACHE = list;
  MEMORY_TIME = now;
  return list;
}
