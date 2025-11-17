export default async function handler(req, res) {
  // Activer CORS pour permettre ton app GoodBarber
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(200).end();
    return;
  }

  const { date, dept = "", category = "", type = "" } = req.query;

  try {
    // 1) Récupération de la page HTML Padel Magazine
    const upstream = await fetch("https://tournois.padelmagazine.fr/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (PadelProxyApp/1.0)",
        Accept: "text/html",
      },
    });

    if (!upstream.ok) {
      throw new Error("Unable to reach Padel Magazine");
    }

    const html = await upstream.text();

    // 2) On parse tous les blocs <div class="tournoi-item">
    const tournaments = [];
    const blocks = html.split('<div class="tournoi-item">').slice(1);

    for (const block of blocks) {
      const itemHtml = block.split("</div>")[0];

      const t = extractTournament(itemHtml);

      if (!t) continue;

      // 3) Filtres dynamiques (date / catégorie / type / département)
      if (date && t.startDate !== date) continue;
      if (dept && t.department !== dept) continue;
      if (category && t.category !== category) continue;
      if (type && t.type !== type) continue;

      tournaments.push(t);
    }

    // 4) Retour JSON
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    res.status(200).json(tournaments);
  } catch (err) {
    console.error(err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: "Proxy error", details: err.message });
  }
}

//
// ------- Extraction d’un tournoi depuis un bloc HTML -------
//
function extractTournament(block) {
  // Nom + catégorie + type
  const nameMatch = block.match(/<h4 class="name">([^<]+)<\/h4>/);
  if (!nameMatch) return null;
  const fullName = clean(nameMatch[1]); // Exemple "P100 HOMMES"

  const category = extractCategory(fullName);      // "P100"
  const type = extractType(fullName);              // "H", "F", "M", "J"
  const name = fullName;                           // on garde le titre entier

  // Date (format humain → ISO)
  const dateMatch = block.match(/<span class="month">([^<]+)<\/span>/);
  const dateText = dateMatch ? clean(dateMatch[1]) : "";
  const isoDate = toISODate(dateText);             // "2025-11-17"

  // Club
  const clubMatch = block.match(/<a href="[^"]+" class="text">([^<]+)<\/a>/);
  const clubName = clubMatch ? clean(clubMatch[1]) : "";

  // Ville (toujours la dernière <span class="text"> dans le bloc club)
  const cityMatch = block.match(/<img src="\/images\/adresse.svg"[^>]*>\s*<span class="text">\s*([^<]+)/);
  const city = cityMatch ? clean(cityMatch[1]) : "";

  // Département (on tente d’extraire un code postal)
  const cpMatch = block.match(/\b(\d{5})\b/);
  const department = cpMatch ? cpMatch[1].substring(0, 2) : "";

  // Logo (Padel Magazine n’a pas l’air d’en fournir)
  const logoUrl = null;

  return {
    id: name + "_" + isoDate + "_" + clubName, // identifiant généré
    name,
    club: clubName,
    city,
    department,
    category,
    type,
    startDate: isoDate,
    endDate: isoDate,
    logoUrl,
  };
}

//
// ------- Helpers -------
//

// Nettoyage texte
function clean(str) {
  return str.replace(/\s+/g, " ").trim();
}

// Détection catégorie (ex: P25 / P100 / P250 / P500…)
function extractCategory(title) {
  const match = title.match(/P\d+/i);
  return match ? match[0].toUpperCase() : "LOISIR";
}

// Détection type : Hommes / Femmes / Mixte / Jeunes
function extractType(title) {
  title = title.toLowerCase();
  if (title.includes("homme") || title.includes("hommes")) return "H";
  if (title.includes("femme") || title.includes("dame")) return "F";
  if (title.includes("mixte")) return "M";
  if (title.includes("jeune")) return "J";
  return "";
}

// Convertir "17 nov. 2025" → "2025-11-17"
function toISODate(text) {
  if (!text) return "";

  const mois = {
    janv: "01",
    févr: "02",
    mars: "03",
    avr: "04",
    mai: "05",
    juin: "06",
    juil: "07",
    août: "08",
    sept: "09",
    oct: "10",
    nov: "11",
    déc: "12",
  };

  const m = text.match(/(\d{1,2})\s+([A-Za-zéû\.]+)\s+(\d{4})/);
  if (!m) return "";

  const jour = m[1].padStart(2, "0");
  const moisTxt = m[2].replace(".", "");
  const moisNum = mois[moisTxt] || "01";
  const annee = m[3];

  return `${annee}-${moisNum}-${jour}`;
}
