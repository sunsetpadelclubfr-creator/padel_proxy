// api/padel-proxy.js

let CACHE = null;
let CACHE_TIME = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6h

export default async function handler(req, res) {
  // CORS basique
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const {
    date = "",
    dept = "",
    category = "",
    type = "",
    refresh = "",
  } = req.query;

  const forceRefresh = refresh === "1";

  try {
    // 1) Si on a un cache valide et pas de refresh forcé → on filtre le cache
    if (!forceRefresh && CACHE && Date.now() - CACHE_TIME < CACHE_DURATION) {
      const filtered = applyFilters(CACHE, { date, dept, category, type });
      return res.status(200).json(filtered);
    }

    // 2) Sinon, on recharge toutes les pages + parse
    const tournaments = await fetchAndParseAll();

    CACHE = tournaments;
    CACHE_TIME = Date.now();

    const filtered = applyFilters(tournaments, { date, dept, category, type });
    return res.status(200).json(filtered);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "Proxy error", details: err.message });
  }
}

//
// ---------- FETCH & PARSE ----------
//

async function fetchAndParseAll() {
  let allHTML = "";

  for (let page = 1; page <= 10; page++) {
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

    // Si plus de tournois → on arrête
    if (!html.includes('class="tournoi-item"')) break;

    allHTML += html;
  }

  const regex =
    /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;

  const tournaments = [];
  let match;

  while ((match = regex.exec(allHTML)) !== null) {
    const block = match[0];
    const parsed = extractTournament(block);
    if (parsed) tournaments.push(parsed);
  }

  return tournaments;
}

//
// ---------- FILTRES ----------
//

function applyFilters(list, { date, dept, category, type }) {
  return list.filter((t) => {
    if (date && t.tournament.startDate !== date) return false;

    if (dept) {
      const wanted = dept
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (wanted.length && !wanted.includes(t.club.department)) return false;
    }

    if (category) {
      const wanted = category
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (wanted.length && !wanted.includes(t.tournament.category)) return false;
    }

    if (type) {
      const wanted = type
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (wanted.length && !wanted.includes(t.tournament.type)) return false;
    }

    return true;
  });
}

//
// ---------- PARSE D’UN TOURNOI ----------
//

function extractTournament(html) {
  // Nom du tournoi
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";
  if (!fullName) return null;

  // Catégorie / type
  const category = extractCategory(fullName);
  const type = extractType(fullName);

  // Date (ex: "17 novembre 2025")
  const dateMatch = html.match(
    /<h5 class="date-responsive[^>]*>([\s\S]*?)<\/h5>/
  );
  const isoDate = dateMatch ? toISODate(clean(dateMatch[1])) : "";

  // Nom du club
  const clubName = get(
    html,
    /<div class="block-infos club">[\s\S]*?<a href="[^"]+" class="text">([\s\S]*?)<\/a>/
  );

  // 📍 Adresse avec code postal (bloc "map-marker")
  const rawLocation = get(
    html,
    /<i class="fas fa-map-marker-alt"><\/i>[\s\S]*?<span>([\s\S]*?)<\/span>/
  );

  // 🏟️ Adresse du club (sans code postal) – en secours
  const rawClubAddress = get(
    html,
    /<img src="\/images\/adresse\.svg"[^>]*>[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );

  // On essaye d’abord l’adresse avec CP, sinon on tombe sur celle du club
  const { street, city, department } = parseAddress(rawLocation || rawClubAddress);

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
      department, // 👈 très important pour le filtre dept
      phone: organizerPhone || "",
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone || "",
    },
  };
}

//
// ---------- HELPERS ----------
//

function clean(str = "") {
  return str.replace(/\s+/g, " ").trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const cleanTxt = clean(text);

  // Cherche "XXXXX Ville"
  const cpCity = cleanTxt.match(/(\d{5})\s+(.+)/);
  if (cpCity) {
    const cp = cpCity[1];
    return {
      street: cleanTxt.replace(cpCity[0], "").replace(/,\s*$/, "").trim(),
      city: cpCity[2].trim(),
      department: cp.substring(0, 2), // ex: "62", "75"…
    };
  }

  // Pas de code postal trouvé → pas de département fiable
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
    janvier: "01",
    févr: "02",
    fevr: "02",
    février: "02",
    mars: "03",
    avril: "04",
    avr: "04",
    mai: "05",
    juin: "06",
    juillet: "07",
    juil: "07",
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

  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/(\d{1,2})\s+([A-Za-zéûôêèàîïùç]+)\s+(\d{4})/i);
  if (!m) return "";

  const day = String(parseInt(m[1], 10)).padStart(2, "0");
  const monthKey = m[2].toLowerCase();
  const month = months[monthKey];
  const year = m[3];

  if (!month) return "";
  return `${year}-${month}-${day}`;
}
