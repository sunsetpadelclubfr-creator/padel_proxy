// api/padel-proxy.js

let CACHE = null;
let CACHE_TIME = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6h

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  const { date = "", dept = "", category = "", type = "", refresh = "", debug = "" } = req.query;

  const forceRefresh = refresh === "1";

  try {
    // 1️⃣ Utilisation du cache si valide et pas de refresh forcé
    let tournaments;
    const now = Date.now();

    if (!forceRefresh && CACHE && now - CACHE_TIME < CACHE_DURATION) {
      tournaments = CACHE;
    } else {
      // 2️⃣ Re-scrape complet
      tournaments = await scrapeAllTournaments();
      CACHE = tournaments;
      CACHE_TIME = now;
    }

    // 3️⃣ Application des filtres
    const filtered = applyFilters(tournaments, { date, dept, category, type });

    // 4️⃣ Mode debug (pour tester dans le navigateur/postman)
    if (debug === "1") {
      return res.status(200).json({
        cacheTime: new Date(CACHE_TIME).toISOString(),
        total: tournaments.length,
        filtered: filtered.length,
        sample: filtered.slice(0, 10),
      });
    }

    return res.status(200).json(filtered);
  } catch (err) {
    console.error("padel-proxy error:", err);
    return res.status(500).json({ error: "Proxy error", details: err.message });
  }
}

/**
 * Scrape toutes les pages de tournois et retourne un tableau d'objets normalisés
 */
async function scrapeAllTournaments() {
  let allHTML = "";
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page++) {
    const resp = await fetch(`https://tournois.padelmagazine.fr/?lapage=${page}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html",
      },
    });

    const html = await resp.text();

    // Si la page ne contient plus de tournois, on arrête
    if (!html.includes("tournoi-item")) break;

    allHTML += html;
  }

  const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
  const tournaments = [];
  let m;

  while ((m = regex.exec(allHTML)) !== null) {
    const block = m[0];
    const parsed = extractTournament(block);
    if (parsed) tournaments.push(parsed);
  }

  return tournaments;
}

/**
 * Applique les filtres date / dept / category / type
 */
function applyFilters(list, { date, dept, category, type }) {
  if (!Array.isArray(list)) return [];

  const normalizedDate = date ? String(date).slice(0, 10) : "";

  const deptList = dept ? dept.split(",").map((d) => d.trim()) : null;
  const catList = category ? category.split(",").map((c) => c.trim()) : null;
  const typeList = type ? type.split(",").map((t) => t.trim()) : null;

  return list.filter((t) => {
    if (!t || !t.tournament || !t.club) return false;

    // 🔹 Filtre date (YYYY-MM-DD)
    if (normalizedDate) {
      const tourDate = (t.tournament.startDate || "").slice(0, 10);
      if (tourDate !== normalizedDate) return false;
    }

    // 🔹 Filtre département
    if (deptList) {
      const tournamentDept = t.club.department || "";
      if (!deptList.includes(tournamentDept)) return false;
    }

    // 🔹 Filtre catégorie
    if (catList && !catList.includes(t.tournament.category)) return false;

    // 🔹 Filtre type
    if (typeList && !typeList.includes(t.tournament.type)) return false;

    return true;
  });
}

/**
 * Parse un bloc HTML de tournoi et renvoie un objet normalisé
 */
function extractTournament(html) {
  // Nom du tournoi
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  // Catégorie & type
  const category = extractCategory(fullName);
  const type = extractType(fullName);

  // Date (texte dans <span class="month">17 nov. 2025</span> par ex.)
  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  // Club (nom, téléphone, adresse)
  const clubName = get(html, /<div class="block-infos club">[\s\S]*?<a href="[^"]+" class="text">([\s\S]*?)<\/a>/);
  const rawClubPhone = get(
    html,
    /<div class="block-infos club">[\s\S]*?<img src="\/images\/phone\.svg"[^>]*>\s*<span class="text">([\s\S]*?)<\/span>/
  );
  const rawClubAddress = get(
    html,
    /<div class="block-infos club">[\s\S]*?<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );

  const clubAddressParsed = parseAddress(rawClubAddress);

  // Organisateur
  const organizerName = get(
    html,
    /<div class="registration-infos">[\s\S]*?<i class="fas fa-user"><\/i>[\s\S]*?<span>([\s\S]*?)<\/span>/
  );
  const organizerEmail = get(
    html,
    /<div class="registration-infos">[\s\S]*?<i class="fas fa-at"><\/i>[\s\S]*?<a href="mailto:[^"]+">([^<]+)<\/a>/
  );
  const organizerPhone = get(
    html,
    /<div class="registration-infos">[\s\S]*?<i class="fas fa-phone-rotary"><\/i>[\s\S]*?<span>([^<]+)<\/span>/
  );
  const organizerAddressText = get(
    html,
    /<div class="registration-infos">[\s\S]*?<i class="fas fa-map-marker-alt"><\/i>[\s\S]*?<span>([\s\S]*?)<\/span>/
  );
  const organizerAddressParsed = parseAddress(organizerAddressText);

  // 🔹 Département : priorité à l’adresse du club, sinon adresse organisateur
  const finalDepartment =
    clubAddressParsed.department || organizerAddressParsed.department || "";

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
      street: clubAddressParsed.street || rawClubAddress || "",
      city: clubAddressParsed.city || "",
      department: finalDepartment,
      phone: rawClubPhone || organizerPhone || "",
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone || rawClubPhone || "",
    },
  };
}

/**
 * Helpers
 */

function clean(str) {
  return str.replace(/\s+/g, " ").trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

// Parse une adresse pour en sortir street / city / department (à partir du CP)
function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const cleanTxt = clean(text);

  // Cherche un motif "62200 BOULOGNE SUR MER"
  const cpCity = cleanTxt.match(/(\d{5})\s+(.+)/);
  if (cpCity) {
    const cp = cpCity[1];
    return {
      street: cleanTxt.replace(cpCity[0], "").replace(/[,;]+$/, "").trim(),
      city: cpCity[2],
      department: cp.substring(0, 2),
    };
  }

  // Pas de CP trouvé : on renvoie tout en "street"
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

function toISODate(text) {
  if (!text) return "";

  const months = {
    janv: "01",
    jan: "01",
    "janvier": "01",
    févr: "02",
    fevr: "02",
    "février": "02",
    mars: "03",
    "mars": "03",
    avr: "04",
    "avril": "04",
    mai: "05",
    juin: "06",
    juil: "07",
    "juillet": "07",
    août: "08",
    aout: "08",
    sept: "09",
    "septembre": "09",
    oct: "10",
    "octobre": "10",
    nov: "11",
    "novembre": "11",
    déc: "12",
    dec: "12",
    "décembre": "12",
  };

  const m = text
    .toLowerCase()
    .match(/(\d{1,2})\s+([a-zéûôîùœç]+)\.?\s+(\d{4})/i);

  if (!m) return "";

  const day = String(m[1]).padStart(2, "0");
  const monthKey = m[2].toLowerCase();
  const year = m[3];

  const month = months[monthKey];
  if (!month) return "";

  return `${year}-${month}-${day}`;
}
