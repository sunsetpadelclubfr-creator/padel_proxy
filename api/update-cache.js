// api/update-cache.js
import { put } from "@vercel/blob";

// combien de pages à scanner
const MAX_PAGES = 10;

export default async function handler(req, res) {
  try {
    // 1. Récupérer tout le HTML de toutes les pages
    let allHTML = "";

    for (let page = 1; page <= MAX_PAGES; page++) {
      const upstream = await fetch(
        `https://tournois.padelmagazine.fr/?lapage=${page}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "text/html",
          },
        }
      );

      const html = await upstream.text();

      // si plus de tournois, on arrête
      if (!html.includes("tournoi-item")) break;

      allHTML += html;
    }

    // 2. Extraire les tournois depuis allHTML
    const tournaments = extractAllTournaments(allHTML);

    // 3. Sauvegarder dans le Blob en JSON
    await put("tournaments.json", JSON.stringify(tournaments), {
      access: "public",
      contentType: "application/json",
    });

    res.status(200).json({
      ok: true,
      count: tournaments.length,
      message: "Cache mis à jour dans Blob ✅",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// -------------------
// helpers de parsing
// -------------------
function extractAllTournaments(allHTML) {
  const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
  const tournaments = [];
  let match;

  while ((match = regex.exec(allHTML)) !== null) {
    const block = match[0];
    const parsed = extractTournament(block);
    if (parsed) tournaments.push(parsed);
  }

  return tournaments;
}

// 👉 ICI tu peux coller TA fonction extractTournament
// et les helpers clean, get, parseAddress, extractCategory, extractType, toISODate
// exactement comme dans ton `api/padel-proxy.js`
function extractTournament(html) {
  // TODO: colle ici la version qui fonctionne déjà chez toi
  return null;
}
