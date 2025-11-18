// api/padel-proxy.js

// --- Cache en mémoire (vivant par instance de fonction) ---
let CACHE = null;
let CACHE_TIME = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6h

export default async function handler(req, res) {
  // CORS + préflight
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(200).end();
  }
  setCors(res);

  const {
    date = "",
    dept = "",
    category = "",
    type = "",
    refresh,
    debug,
  } = req.query;

  const forceRefresh = refresh === "1";

  try {
    // 1) Cache
    if (!forceRefresh && CACHE && Date.now() - CACHE_TIME < CACHE_DURATION) {
      const data = debug === "1" ? CACHE.slice(0, 20) : applyFilters(CACHE, { date, dept, category, type });
      return res.status(200).json(data);
    }

    // 2) Rechargement complet
    let allHTML = "";
    const MAX_PAGES = 10;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const upstream = await fetch(
        `https://tournois.padelmagazine.fr/?lapage=${page}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "text/html",
          },
        }
      );

      if (!upstream.ok) {
        if (page === 1) {
          throw new Error(`Upstream status ${upstream.status}`);
        }
        break;
      }

      const html = await upstream.text();

      if (!html.includes("tournoi-item")) break;

      allHTML += html;
    }

    if (!allHTML) {
      throw new Error("Empty HTML from padelmagazine");
    }

    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
    const tournaments = [];
    let match;

    while ((match = regex.exec(allHTML)) !== null) {
      const block = match[0];
      const parsed = extractTournament(block);
      if (parsed) tournaments.push(parsed);
    }

    CACHE = tournaments;
    CACHE_TIME = Date.now();

    // Mode debug → renvoyer brut
    if (debug === "1") {
      return res.status(200).json(tournaments.slice(0, 50));
    }

    const filtered = applyFilters(tournaments, { date, dept, category, type });
    return res.status(200).json(filtered);
  } catch (err) {
    console.error("padel-proxy error:", err);
    return res
      .status(500)
      .json({ error: "Proxy error", details: err.message || String(err) });
  }
}

// -------------------------------------------------------
// CORS
// -------------------------------------------------------
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// -------------------------------------------------------
// Extraction d'un tournoi
// -------------------------------------------------------
function extractTournament(html) {
  // Nom
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";
  if (!fullName) return null;

  const category = extractCategory(fullName);
  const type = extractType(fullName);

  // Date : essais successifs (h5 puis span.month)
  let dateText =
    get(html, /<h5 class="date-responsive[^>]*>([\s\S]*?)<\/h5>/) ||
    get(html, /<span class="month">([\s\S]*?)<\/span>/);

  const isoDate = toISODate(dateText);

  // Club
  const clubName = get(
    html,
    /<div class="block-infos club">[\s\S]*?<a href="[^"]+" class="text">([\s\S]*?)<\/a>/
  );

  // Téléphone ORGA
  const organizerPhone = get(
    html,
    /<i class="fas fa-phone-rotary"><\/i>[\s\S]*?<span>([\s\S]*?)<\/span>/
  );

  // Adresse brute :
  // priorité fa-map-marker-alt (l'organisateur, avec CP) puis fallback adresse club
  let rawAddress =
    get(
      html,
      /<i class="fas fa-map-marker-alt"><\/i>[\s\S]*?<span>([\s\S]*?)<\/span>/
    ) ||
    get(
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
    /<i class="fas fa-at"><\/i>[\s\S]*?<a href="mailto:[^"]+">([\s\S]*?)<\/a>/
  );

  return {
    tournament: {
      id: `${fullName}_${isoDate || "unknown"}_${clubName || "unknown"}`,
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
      phone: organizerPhone || "",
    },
  };
}

// -------------------------------------------------------
// Helpers parsing
// -------------------------------------------------------
function clean(str) {
  if (!str) return "";
  return String(str)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

// Adresse → rue, ville, département
function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const cleanTxt = clean(text);

  // Dernier CP sur la ligne
  const cpMatch = cleanTxt.match(/(\d{5})(?!.*\d{5})/);
  let department = "";
  let city = "";

  if (cpMatch) {
    const cp = cpMatch[1];
    department = cp.substring(0, 2);

    const afterCp = cleanTxt.slice(cleanTxt.indexOf(cp) + cp.length).trim();
    if (afterCp) city = afterCp;
  }

  return {
    street: cleanTxt,
    city,
    department,
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

// 🔥 Version ultra tolérante
function toISODate(text) {
  if (!text) return "";

  const s = clean(text).toLowerCase();

  const months = {
    janv: "01",
    janvier: "01",
    févr: "02",
    fevr: "02",
    février: "02",
    fevrier: "02",
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
    dec: "12",
    déc: "12",
    decembre: "12",
    décembre: "12",
  };

  // 17 novembre 2025, 17 nov. 2025, etc.
  const m = s.match(/(\d{1,2})\s+([a-z\u00C0-\u017F\.]+)\s+(\d{4})/i);
  if (!m) {
    console.warn("toISODate: impossible de parser", s);
    return "";
  }

  const day = String(parseInt(m[1], 10)).padStart(2, "0");
  let monthKey = m[2]
    .toLowerCase()
    .replace(/\./g, "")
    .trim();

  const month = months[monthKey];
  const year = m[3];

  if (!month) {
    console.warn("toISODate: mois inconnu", monthKey, "dans", s);
    return "";
  }

  return `${year}-${month}-${day}`;
}

// -------------------------------------------------------
// Filtres (date, dept, category, type)
// -------------------------------------------------------
function applyFilters(list, { date, dept, category, type }) {
  if (!Array.isArray(list)) return [];

  const deptList = dept ? dept.split(",").map((d) => d.trim()) : null;
  const catList = category ? category.split(",").map((c) => c.trim()) : null;
  const typeList = type ? type.split(",").map((t) => t.trim()) : null;

  return list.filter((t) => {
    if (!t || !t.tournament || !t.club) return false;

    if (date && t.tournament.startDate !== date) return false;

    if (deptList) {
      const tournamentDept =
        t.club.department ||
        parseDepartmentFromAddress(t.club.street || "") ||
        "";
      if (!deptList.includes(tournamentDept)) return false;
    }

    if (catList && !catList.includes(t.tournament.category)) return false;

    if (typeList && !typeList.includes(t.tournament.type)) return false;

    return true;
  });
}

// fallback si jamais department n'a pas été rempli
function parseDepartmentFromAddress(street) {
  if (!street) return "";
  const m = String(street).match(/(\d{2})\d{3}(?!.*\d{5})/);
  return m ? m[1] : "";
}
