// api/padel-proxy.js

let CACHE = null;
let CACHE_TIME = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6 heures

export default async function handler(req, res) {
  // CORS basique
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { refresh, date = "", dept = "", category = "", type = "" } = req.query;
  const forceRefresh = refresh === "1";

  try {
    // 1) Cache en mémoire
    if (!forceRefresh && CACHE && Date.now() - CACHE_TIME < CACHE_DURATION) {
      const filtered = applyFilters(CACHE, { date, dept, category, type });
      return res.status(200).json(filtered);
    }

    // 2) On (re)charge les données depuis Padel Magazine
    const tournaments = await fetchAllTournaments();

    // On met en cache
    CACHE = tournaments;
    CACHE_TIME = Date.now();

    // 3) On applique les filtres
    const filtered = applyFilters(tournaments, { date, dept, category, type });

    return res.status(200).json(filtered);
  } catch (e) {
    console.error("padel-proxy error:", e);
    return res.status(500).json({ error: e.message });
  }
}

/* ------------------- FILTRES ------------------- */

function applyFilters(tournaments, { date, dept, category, type }) {
  return tournaments.filter((t) => {
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
}

/* -------------- RÉCUP TOUS LES TOURNOIS -------------- */

async function fetchAllTournaments() {
  let allHTML = "";
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page++) {
    const resp = await fetch(
      `https://tournois.padelmagazine.fr/?lapage=${page}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "text/html",
        },
      }
    );

    const html = await resp.text();

    if (!html.includes("tournoi-item")) break;

    allHTML += html;
  }

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

/* -------------- PARSING D'UN TOURNOI -------------- */

function extractTournament(html) {
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  const category = extractCategory(fullName);
  const type = extractType(fullName);

  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  const clubName = get(
    html,
    /<a href="[^"]+" class="text">([\s\S]*?)<\/a>/
  );

  // ⬇️ NOUVEAU : on récupère tout le bloc adresse puis on enlève le HTML
  const rawAddress = getAddress(html);

  const { street, city, department } = parseAddress(rawAddress);

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
      department,
      phone: organizerPhone || "",
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone,
    },
  };
}

/* -------------- HELPERS -------------- */

function clean(str = "") {
  return str.replace(/\s+/g, " ").trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

// ⬇️ NOUVEAU : récupère le texte d'adresse complet autour de l'icône
function getAddress(html) {
  const blockMatch = html.match(
    /<img src="\/images\/adresse\.svg"[\s\S]*?<\/div>/
  );
  if (!blockMatch) return "";
  const block = blockMatch[0];

  // On enlève toutes les balises HTML
  const textOnly = block.replace(/<[^>]+>/g, " ");
  return clean(textOnly);
}

// Adresse → rue + CP + ville + département
function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const cleanTxt = clean(text);

  // On prend le DERNIER code postal à 5 chiffres dans la chaîne
  const m = cleanTxt.match(/(\d{5})(?!.*\d{5})/);
  if (!m) {
    return { street: cleanTxt, city: "", department: "" };
  }

  const cp = m[1];
  const idx = cleanTxt.indexOf(cp);

  const before = cleanTxt.slice(0, idx).trim();           // rue
  const after = cleanTxt.slice(idx + cp.length).trim();   // ville

  return {
    street: before,
    city: after,
    department: cp.substring(0, 2),
  };
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

function toISODate(text) {
  if (!text) return "";
  const months = {
    janv: "01",
    févr: "02",
    fevr: "02",
    mars: "03",
    avr: "04",
    mai: "05",
    juin: "06",
    juil: "07",
    août: "08",
    aout: "08",
    sept: "09",
    oct: "10",
    nov: "11",
    déc: "12",
    dec: "12",
  };

  const m = text.match(/(\d+)\s+([a-zéûô]+)\.?\s+(\d{4})/i);
  if (!m) return "";

  const day = String(m[1]).padStart(2, "0");
  const monthKey = m[2].toLowerCase();
  const month = months[monthKey] || "01";
  const year = m[3];

  return `${year}-${month}-${day}`;
}
