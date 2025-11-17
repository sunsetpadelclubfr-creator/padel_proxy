// api/padel-proxy.js

let CACHE = null;
let CACHE_TIME = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6h

export default async function handler(req, res) {
  const { refresh } = req.query;

  // ❗ REFRESH =1 → On force une mise à jour complète
  const forceRefresh = refresh === "1";

  // ❗ Si pas refresh → on sert cache si valide
  if (!forceRefresh && CACHE && Date.now() - CACHE_TIME < CACHE_DURATION) {
    return res.status(200).json(CACHE);
  }

  try {
    let allHTML = "";
    for (let page = 1; page <= 10; page++) {
      const resp = await fetch(`https://tournois.padelmagazine.fr/?lapage=${page}`);
      const html = await resp.text();

      if (!html.includes("tournoi-item")) break;

      allHTML += html;
    }

    // Extraction via regex (ta version à toi)
    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
    const tournaments = [];

    let m;
    while ((m = regex.exec(allHTML)) !== null) {
      tournaments.push({ raw: m[0] }); // simplification (à remplacer par ta fonction extractTournament)
    }

    CACHE = tournaments;
    CACHE_TIME = Date.now();

    return res.status(200).json(tournaments);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

