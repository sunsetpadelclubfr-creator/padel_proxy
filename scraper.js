import fs from "fs";
import fetch from "node-fetch";

const MAX_PAGES = 80;
let allHTML = "";
let pagesWithTournaments = 0;

(async () => {
  console.log("🔵 Début du scraping Padelmag…");

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://tournois.padelmagazine.fr/?lapage=${page}`;
    console.log("→ Page", page, url);

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (padel-scraper bot)",
      },
    });

    const html = await resp.text();

    if (!html.includes("tournoi-item")) {
      console.log("❌ Fin — plus de tournois après la page", page);
      break;
    }

    pagesWithTournaments++;
    allHTML += html;

    await new Promise((res) => setTimeout(res, 200));
  }

  console.log("🔵 Pages avec tournois :", pagesWithTournaments);

  // Extraction
  const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
  const tournaments = [];
  let m;

  while ((m = regex.exec(allHTML)) !== null) {
    tournaments.push(m[0]);
  }

  console.log("🟢 Tournois détectés :", tournaments.length);

  // Sauvegarde brute
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/tournaments.json", JSON.stringify(tournaments, null, 2));

  console.log("✅ Fichier sauvegardé : data/tournaments.json");
})();
