// api/padel-proxy.js

// ------------------ CACHE MÉMOIRE ------------------
let CACHE = null;
let CACHE_TIME = 0;
// durée du cache : 24 heures
const CACHE_DURATION = 1000 * 60 * 60 * 24;

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

  const forceRefresh = refresh === "1";

  // 1. SERVIR LE CACHE SI VALIDE + pas de refresh forcé
  if (!forceRefresh && CACHE && Date.now() - CACHE_TIME < CACHE_DURATION) {
    return res.status(200).json(applyFilters(CACHE, { date, dept, category, type }));
  }

  try {
    // 2. SCRAPING PADELMAG
    let allHTML = "";
    const maxPages = 20;

    for (let page = 1; page <= maxPages; page++) {
      const resp = await fetch(`https://tournois.padelmagazine.fr/?lapage=${page}`, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "text/html",
        },
      });

      if (!resp.ok) break;

      const html = await resp.text();
      if (!html.includes("tournoi-item")) break;
      allHTML += html;
    }

    // 3. EXTRACTION DES TOURNOIS
    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
    const tournaments = [];
    let m;

    while ((m = regex.exec(allHTML)) !== null) {
      const block = m[0];
      const t = extractTournament(block);
      if (t) tournaments.push(t);
    }

    // 4. METTRE À JOUR LE CACHE
    CACHE = tournaments;
    CACHE_TIME = Date.now();

    // 5. APPLIQUER LES FILTRES
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

// ------------------ EXTRACTION ------------------
function extractTournament(html) {
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";
  if (!fullName) return null;

  const category = extractCategory(fullName);
  const type = extractType(fullName);

  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  const clubName = get(html, /<a href="[^"]+" class="text">([\s\S]*?)<\/a>/);
  const clubPhone = get(
    html,
    /<img src="\/images\/phone\.svg"[^>]*>\s*<span class="text">([^<]+)<\/span>/
  );
  const rawAddress = get(
    html,
    /<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );

  const { street, city, department } = parseAddress(rawAddress);

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
      phone: clubPhone || "",
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

function parseAddress(txt) {
  if (!txt) return { street: "", city: "", department: "" };
  txt = clean(txt);

  const match = txt.match(/(\d{5})\s+(.+)/);
  if (match) {
    const cp = match[1];
    return {
      street: txt.replace(match[0], "").trim(),
      city: match[2],
      department: cp.substring(0, 2),
    };
  }

  return { street: txt, city: "", department: "" };
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
    janvier: "01", janv: "01",
    février: "02", fevr: "02", févr: "02",
    mars: "03",
    avril: "04", avr: "04",
    mai: "05",
    juin: "06",
    juillet: "07", juil: "07",
    août: "08", aout: "08",
    septembre: "09", sept: "09",
    octobre: "10", oct: "10",
    novembre: "11", nov: "11",
    décembre: "12", dec: "12"
  };

  const m = text.match(/(\d{1,2})\s+([a-zéûôàîù]+)/i);
  const y = text.match(/(\d{4})/);

  if (!m || !y) return "";

  const day = m[1].padStart(2, "0");
  const month = months[m[2].toLowerCase()] || "";
  const year = y[1];

  return `${year}-${month}-${day}`;
}
