import { put } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    console.log("➡ Début mise à jour du cache…");

    // ---- 1) Récupération des pages du site Padel Magazine ----
    let allHTML = "";
    for (let page = 1; page <= 10; page++) {
      const resp = await fetch(`https://tournois.padelmagazine.fr/?lapage=${page}`);
      const html = await resp.text();
      console.log("Page récupérée :", page);

      if (!html.includes("tournoi-item")) break;

      allHTML += html;
    }

    if (!allHTML || allHTML.length < 500) {
      throw new Error("HTML trop court — scraping échoué.");
    }

    // ---- 2) Extraction simple (on stocke le HTML brut pour tester) ----
    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
    const matches = [...allHTML.matchAll(regex)];

    console.log("➡ Tournois trouvés :", matches.length);

    // ---- 3) Stockage dans le Blob ----
    const jsonToStore = JSON.stringify({ count: matches.length, data: matches }, null, 2);

    const { url } = await put("cache/tournaments.json", jsonToStore, {
      access: "public",
    });

    console.log("➡ Mise à jour OK :", url);

    return res.status(200).json({
      ok: true,
      stored: matches.length,
      url
    });

  } catch (err) {
    console.error("❌ ERREUR :", err);
    return res.status(500).json({ error: err.message });
  }
}
