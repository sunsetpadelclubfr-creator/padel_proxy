// api/padel-proxy.js

let CACHE = null;
let CACHE_TIME = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6h

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { refresh, date = "", dept = "", category = "", type = "" } = req.query;
  const forceRefresh = refresh === "1";

  // Serve cache if valid
  if (!forceRefresh && CACHE && Date.now() - CACHE_TIME < CACHE_DURATION) {
    return res.status(200).json(applyFilters(CACHE, { date, dept, category, type }));
  }

  try {
    // Collect all pages (up to 10)
    let allHTML = "";
    for (let page = 1; page <= 10; page++) {
      const upstream = await fetch(`https://tournois.padelmagazine.fr/?lapage=${page}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 PadelProxy",
        },
      });

      const html = await upstream.text();

      if (!html.includes("tournoi-item")) break;

      allHTML += html;
    }

    // Extract all tournaments
    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
    const tournaments = [];

    let match;
    while ((match = regex.exec(allHTML)) !== null) {
      const block = match[0];
      const parsed = extractTournament(block);
      if (parsed) tournaments.push(parsed);
    }

    // Update cache
    CACHE = tournaments;
    CACHE_TIME = Date.now();

    // Return filtered
    return res.status(200).json(applyFilters(tournaments, { date, dept, category, type }));

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({ error: "Proxy crash", details: err.message });
  }
}

//
// ------------------------ FILTERING ------------------------
//
function applyFilters(list, { date, dept, category, type }) {
  return list.filter((t) => {
    if (date && t.tournament.startDate !== date) return false;

    if (dept) {
      const wanted = dept.split(","); // allow multiple departments
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

//
// ------------------------ PARSING ------------------------
//
function extractTournament(html) {
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";
  if (!fullName) return null;

  const category = extractCategory(fullName);
  const type = extractType(fullName);

  // Date: <h5 class="date-responsive ...">17 novembre 2025</h5>
  const dateMatch = html.match(/<h5 class="date-responsive[^>]*>([\s\S]*?)<\/h5>/);
  const isoDate = dateMatch ? toISODate(clean(dateMatch[1])) : "";

  // Club name
  const clubName = get(
    html,
    /<div class="block-infos club">[\s\S]*?<a href="[^"]+" class="text">([\s\S]*?)<\/a>/
  );

  // Address of organizer (with postal code)
  const rawLocation = get(
    html,
    /<i class="fas fa-map-marker-alt"><\/i>[\s\S]*?<span>([\s\S]*?)<\/span>/
  );

  // Address of club (backup)
  const rawClubAddress = get(
    html,
    /<img src="\/images\/adresse\.svg"[^>]*>[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );

  const { street, city, department } = parseAddress(rawLocation || rawClubAddress);

  // Organizer
  const organizerName = get(html, /<i class="fas fa-user"><\/i>[\s\S]*?<span>([\s\S]*?)<\/span>/);
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
      phone: organizerPhone || "",
    },
  };
}

//
// ------------------------ HELPERS ------------------------
//
function clean(str) {
  return (str || "").replace(/\s+/g, " ").trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const txt = clean(text);

  // Grab first postal code
  const cpMatch = txt.match(/(\d{5})/);
  if (cpMatch) {
    const cp = cpMatch[1];
    const parts = txt.split(cp);

    const street = clean(parts[0].replace(/,\s*$/, ""));
    const city = clean(parts[1] || "");

    return {
      street,
      city,
      department: cp.substring(0, 2), // ← Département correct !
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
    janvier: "01",
    janv: "01",
    février: "02",
    fevrier: "02",
    févr: "02",
    fevr: "02",
    mars: "03",
    avril: "04",
    avr: "04",
    mai: "05",
    juin: "06",
    juillet: "07",
    juil: "07",
    août: "08",
    aout: "08",
    septembre: "09",
    sept: "09",
    octobre: "10",
    oct: "10",
    novembre: "11",
    nov: "11",
    décembre: "12",
    dec: "12",
  };

  const m = text.match(/(\d+)\s+([a-zéûôà]+)\s+(\d{4})/i);
  if (!m) return "";

  const day = m[1].padStart(2, "0");
  const month = months[m[2].toLowerCase()] || "01";
  const year = m[3];

  return `${year}-${month}-${day}`;
}

