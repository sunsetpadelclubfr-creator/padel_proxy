// api/update-cache.js

export default async function handler(req, res) {
  try {
    console.log("➡ [/api/update-cache] Début de la mise à jour du cache...");

    // 1) Import dynamique de @vercel/blob (pour capturer les erreurs éventuelles)
    let put;
    try {
      const blobModule = await import("@vercel/blob");
      put = blobModule.put;
      console.log("✅ Module @vercel/blob chargé");
    } catch (e) {
      console.error("❌ Erreur lors du import('@vercel/blob') :", e);
      return res.status(500).json({
        ok: false,
        step: "import_blob",
        error: e.message,
      });
    }

    // 2) Scraper les pages Padel Magazine
    let allHTML = "";
    const maxPages = 10;

    for (let page = 1; page <= maxPages; page++) {
      const url = `https://tournois.padelmagazine.fr/?lapage=${page}`;
      console.log("➡ Récupération page :", url);

      const resp = await fetch(url);

      if (!resp.ok) {
        console.warn("⚠️ Page non OK :", url, resp.status);
        break;
      }

      const html = await resp.text();

      if (!html.includes("tournoi-item")) {
        console.log("⛔ Aucune 'tournoi-item' sur la page", page, "— arrêt.");
        break;
      }

      allHTML += html;
    }

    if (!allHTML || allHTML.length < 500) {
      console.error("❌ HTML récupéré trop court, longueur =", allHTML.length);
      return res.status(500).json({
        ok: false,
        step: "scraping",
        error: "HTML trop court, scraping probablement échoué.",
        length: allHTML.length,
      });
    }

    // 3) Extraction brute des blocs tournoi (regex simple)
    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
    const matches = [...allHTML.matchAll(regex)];
    console.log("✅ Nombre de blocs 'tournoi-item' trouvés :", matches.length);

    const payload = {
      generatedAt: new Date().toISOString(),
      count: matches.length,
      // On stocke juste le HTML brut des blocs pour le moment
      tournaments: matches.map((m) => m[0]),
    };

    const jsonToStore = JSON.stringify(payload, null, 2);

    // 4) Écriture dans le Blob
    let blobUrl = null;
    let blobError = null;

    try {
      const result = await put("cache/tournaments.json", jsonToStore, {
        access: "public",
      });
      blobUrl = result.url;
      console.log("✅ Cache écrit dans le blob :", blobUrl);
    } catch (e) {
      console.error("❌ Erreur lors du put() vers Vercel Blob :", e);
      blobError = e.message || "Erreur inconnue lors de l'écriture blob";
    }

    // 5) Réponse HTTP
    return res.status(200).json({
      ok: true,
      step: "done",
      stored: matches.length,
      blobUrl,
      blobError,
    });
  } catch (err) {
    console.error("💥 ERREUR GLOBALE dans /api/update-cache :", err);
    return res.status(500).json({
      ok: false,
      step: "global_catch",
      error: err.message,
      stack: err.stack,
    });
  }
}
