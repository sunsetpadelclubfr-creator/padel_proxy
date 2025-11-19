// api/padel-proxy.js

// ------------------ CACHE MÉMOIRE ------------------
let CACHE = null;
let CACHE_TIME = 0;
// durée du cache : 6 heures
const CACHE_DURATION = 1000 * 60 * 60 * 6;

// ------------------ HANDLER PRINCIPAL ------------------
export default async function handler(req, res) {
  // Préflight CORS
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  const { date = "", dept = "", category = "", type = "", refresh = "" } = req.query;

  // Si pas de ?refresh=1 → on sert le cache s'il est encore valide
  const forceRefresh = refresh === "1";
  if (!forceRefresh && CACHE && Date.now() - CACHE_TIME < CACHE_DURATION) {
    const filtered = applyFilters(CACHE, { date, dept, category, type });
    return res.status(200).json(filtered);
  }

  try {
    // 1) On charge toutes les pages Padelmag
    let allHTML = "";
    const maxPages = 20; // au cas où

    for (let page = 1; page <= maxPages; page++) {
      const upstream = await fetch(
        `https://tournois.padelmagazine.fr/?lapage=${page}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0",
            Accept: "text/html",
          },
        }
      );

      const html = await upstream.text();

      // si plus aucun tournoi dans la page, on arrête
      if (!html.includes("tournoi-item")) break;

      allHTML += html;
    }

    // 2) Extraction de chaque bloc tournoi
    const regex =
      /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;

    const tournaments = [];
    let m;

    while ((m = regex.exec(allHTML)) !== null) {
      const block = m[0];
      const parsed = extractTournament(block);
      if (parsed) tournaments.push(parsed);
    }

    // 3) On met à jour le cache global
    CACHE = tournaments;
    CACHE_TIME = Date.now();

    // 4) On applique les filtres demandés
    const filtered = applyFilters(tournaments, { date, dept, category, type });

    return res.status(200).json(filtered);
  } catch (err) {
    console.error("Padelmag proxy error:", err);
    return res.status(500).json({
      error: "Padelmag proxy error",
      details: err.message,
    });
  }
}

// ------------------ FILTRES ------------------
function applyFilters(tournaments, { date, dept, category, type }) {
  return tournaments.filter((t) => {
    if (date && t.tournament.startDate !== date) return false;

    if (dept) {
      const wanted = dept.split(",").map((d) => d.trim());
      if (!wanted.includes(t.club.department)) return false;
    }

    if (category) {
      const wanted = category.split(",").map((c) => c.trim());
      if (!wanted.includes(t.tournament.category)) return false;
    }

    if (type) {
      const wanted = type.split(",").map((x) => x.trim());
      if (!wanted.includes(t.tournament.type)) return false;
    }

    return true;
  });
}

// ------------------ PARSING D'UN TOURNOI ------------------
function extractTournament(html) {
  // Nom complet
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  if (!fullName) return null;

  // Catégorie
  const category = extractCategory(fullName);

  // Type (H/F/M)
  const type = extractType(fullName);

  // Date
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
      department, // peut être vide si Padelmag ne fournit pas de CP
      phone: organizerPhone || clubPhone || "",
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone || "",
    },
  };
}

// ------------------ HELPERS ------------------
function clean(str = "") {
  return str.replace(/\s+/g, " ").trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

// Essaie de récupérer rue / ville / département à partir d'une adresse
function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const cleanTxt = clean(text);

  // Si un code postal à 5 chiffres est présent, on s'en sert
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

function extractCategory(title) {
  const m = title.match(/P\d+/i);
  return m ? m[0].toUpperCase() : "LOISIR";
}

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
