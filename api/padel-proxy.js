// api/padel-proxy.js

let CACHE = null;
let CACHE_TIME = 0;
// 12h → mis à jour 2 fois par jour par le cron
const CACHE_DURATION = 1000 * 60 * 60 * 12;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(200).end();
  }

  const { date = "", dept = "", category = "", type = "", refresh } = req.query;

  const forceRefresh = refresh === "1";

  // 👉 Si on ne force pas le refresh ET que le cache est encore valide
  if (!forceRefresh && CACHE && Date.now() - CACHE_TIME < CACHE_DURATION) {
    const filtered = applyFilters(CACHE, { date, dept, category, type });
    setCors(res);
    return res.status(200).json(filtered);
  }

  try {
    // 🟧 1 — Récupération TOUTES PAGES
    let allHTML = "";
    let page = 1;
    const maxPages = 10;

    while (page <= maxPages) {
      const upstream = await fetch(
        `https://tournois.padelmagazine.fr/?lapage=${page}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "text/html",
          },
        }
      );

      const html = await upstream.text();

      // si plus de "tournoi-item", on s'arrête
      if (!html.includes("tournoi-item")) break;

      allHTML += html;
      page++;
    }

    // 🟧 2 — Extraction de tous les tournois
    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;

    const tournaments = [];
    let match;

    while ((match = regex.exec(allHTML)) !== null) {
      const block = match[0];
      const parsed = extractTournament(block);
      if (parsed) tournaments.push(parsed);
    }

    // 🟧 3 — Mise à jour du cache
    CACHE = tournaments;
    CACHE_TIME = Date.now();

    // 🟧 4 — Application des filtres demandés
    const filtered = applyFilters(CACHE, { date, dept, category, type });

    setCors(res);
    return res.status(200).json(filtered);
  } catch (e) {
    console.error("padel-proxy error:", e);
    setCors(res);
    return res.status(500).json({ error: "Proxy error", details: e.message });
  }
}

/* ------------------- HELPERS ------------------- */

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function applyFilters(data, { date, dept, category, type }) {
  return data.filter((t) => {
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

function clean(str) {
  return str.replace(/\s+/g, " ").trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const cleanTxt = clean(text);

  const cpCity = cleanTxt.match(/(\d{5})\s+(.+)/);
  if (cpCity) {
    const cp = cpCity[1];
    return {
      street: cleanTxt.replace(cpCity[0], "").trim(),
      city: cpCity[2],
      department: cp.substring(0, 2),
    };
  }

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

// "28 décembre 2025" → "2025-12-28"
function toISODate(text) {
  const months = {
    janv: "01",
    février: "02",
    fevrier: "02",
    févr: "02",
    fevr: "02",
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
    decembre: "12",
  };

  const m = text.match(/(\d+)\s+([a-zéûôîù]+)\.?\s+(\d{4})/i);
  if (!m) return "";

  const monthKey = m[2].toLowerCase();
  const month = months[monthKey] || "01";

  return `${m[3]}-${month}-${String(m[1]).padStart(2, "0")}`;
}

function extractTournament(html) {
  // Nom
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  // Catégorie
  const category = extractCategory(fullName);

  // Type
  const type = extractType(fullName);

  // Date (texte dans <span class="month">...</span>)
  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  // Club
  const clubName = get(html, /<a href="[^"]+" class="text">([\s\S]*?)<\/a>/);
  const rawAddress = get(
    html,
    /<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );
  const clubPhone = get(
    html,
    /<img src="\/images\/phone\.svg"[^>]*>\s*<span class="text">([\s\S]*?)<\/span>/
  );

  const { street, city, department } = parseAddress(rawAddress);

  // Organisateur test
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

  if (!fullName || !isoDate) return null;

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
      phone: clubPhone || organizerPhone || "",
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone,
    },
  };
}
