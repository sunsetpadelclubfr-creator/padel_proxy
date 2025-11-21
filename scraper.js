// scraper.js
// Scraping Padel Magazine → data/padel-tournaments.json
// - utilise fetch natif de Node 18+
// - parse page par page (plus léger que tout concaténer)

import fs from "node:fs/promises";

const BASE_URL = "https://tournois.padelmagazine.fr/?lapage=";
const MAX_PAGES = 50; // on arrêtera avant si plus de tournois
const OUTPUT_FILE = "data/padel-tournaments.json";

async function main() {
  console.log("🚀 Début du scraping Padel Magazine...");

  const allTournaments = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${BASE_URL}${page}`;
    console.log(`📄 Page ${page} → ${url}`);

    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0",
        Accept: "text/html",
      },
    });

    if (!resp.ok) {
      console.warn(`⚠️ HTTP ${resp.status} sur la page ${page}, on stoppe.`);
      break;
    }

    const html = await resp.text();

    // Si plus de blocs tournoi → on arrête le scraping
    if (!html.includes("tournoi-item")) {
      console.log(`⛔ Aucun tournoi trouvé sur la page ${page}, stop.`);
      break;
    }

    // Match des blocs de tournois sur CETTE page uniquement
    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
    const pageTournaments = [];
    let m;

    while ((m = regex.exec(html)) !== null) {
      const block = m[0];
      const parsed = extractTournament(block);
      if (parsed) pageTournaments.push(parsed);
    }

    console.log(
      `✅ Page ${page} : ${pageTournaments.length} tournois extraits.`
    );

    allTournaments.push(...pageTournaments);

    // petite pause pour ne pas spammer le site (optionnel)
    await sleep(300);
  }

  console.log(`📊 Total tournois collectés : ${allTournaments.length}`);

  // Création du dossier si besoin
  await fs.mkdir("data", { recursive: true });

  // Écriture du JSON final
  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify(allTournaments, null, 2),
    "utf8"
  );

  console.log(`💾 Fichier sauvegardé dans : ${OUTPUT_FILE}`);
}

// ------------------ HELPERS ------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nettoie les espaces
function clean(str = "") {
  return str.replace(/\s+/g, " ").trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

// Parsing d’un bloc tournoi
function extractTournament(html) {
  // Nom complet
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";
  if (!fullName) return null;

  // Catégorie
  const category = extractCategory(fullName);

  // Type (H/F/M)
  const type = extractType(fullName);

  // Date : ex. "18 novembre 2025"
  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  // Club
  const clubName = get(
    html,
    /<a href="[^"]+" class="text">([\s\S]*?)<\/a>/
  );
  const clubPhone = get(
    html,
    /<img src="\/images\/phone\.svg"[^>]*>\s*<span class="text">([\s\S]*?)<\/span>/
  );
  const rawAddress = get(
    html,
    /<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );

  const { street, city, department } = parseAddress(rawAddress);

  // Organisateur
  const organizerName = get(
    html,
    /<i class="fas fa-user"><\/i>[\s\S]*?<span>([\s\S]*?)<\/span>/
  );
  const organizerEmail = get(
    html,
    /<i class="fas fa-at"><\/i>[\s\S]*?<a href="mailto:[^"]+">([^<]+)<\/a>/
  );
  const organizerPhone = get(
    html,
    /<i class="fas fa-phone-rotary"><\/i>[\s\S]*?<span>([^<]+)<\/span>/
  );

  return {
    tournament: {
      id: `${fullName}_${isoDate}_${clubName}`,
      name: fullName,
      category,
      type,
      startDate: isoDate,
      endDate: isoDate,
    },
    club: {
      name: clubName,
      street,
      city,
      department, // dépend surtout du code postal dans l’adresse
      phone: organizerPhone || clubPhone || "",
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone || "",
    },
  };
}

// Adresse → rue / ville / département (si CP présent)
function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const cleanTxt = clean(text);

  // Si un code postal à 5 chiffres est présent
  const cpCity = cleanTxt.match(/(\d{5})\s+(.+)/);
  if (cpCity) {
    const cp = cpCity[1];
    return {
      street: cleanTxt.replace(cpCity[0], "").trim(),
      city: cpCity[2],
      department: cp.substring(0, 2),
    };
  }

  // Sinon : on renvoie juste la rue complète, sans département
  return { street: cleanTxt, city: "", department: "" };
}

// Catégorie : P100 / P250 / etc
function extractCategory(title) {
  const m = title.match(/P\d+/i);
  return m ? m[0].toUpperCase() : "LOISIR";
}

// Type : H / F / M
function extractType(title) {
  const t = title.toLowerCase();
  if (t.includes("homme")) return "H";
  if (t.includes("femme") || t.includes("dame")) return "F";
  if (t.includes("mixte")) return "M";
  return "";
}

// Convertit "18 novembre 2025" → "2025-11-18"
function toISODate(text) {
  if (!text) return "";

  const months = {
    janv: "01",
    janvier: "01",
    févr: "02",
    fevr: "02",
    février: "02",
    mars: "03",
    avr: "04",
    avril: "04",
    mai: "05",
    juin: "06",
    juil: "07",
    juillet: "07",
    août: "08",
    aout: "08",
    sept: "09",
    septembre: "09",
    oct: "10",
    octobre: "10",
    nov: "11",
    novembre: "11",
    déc: "12",
    dec: "12",
    décembre: "12",
  };

  const m = text.match(
    /(\d{1,2})\s+([a-zéûôàîù]+)\.?\s+(\d{4})/i
  );
  if (!m) return "";

  const day = String(m[1]).padStart(2, "0");
  const monthKey = m[2].toLowerCase();
  const year = m[3];

  const month = months[monthKey];
  if (!month) return "";

  return `${year}-${month}-${day}`;
}

// Lancer le script
main().catch((err) => {
  console.error("❌ Erreur pendant le scraping :", err);
  process.exit(1);
});
