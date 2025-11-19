// api/padel-proxy.js

let CACHE = [];
let LAST_REFRESH = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6 heures

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    const {
      refresh = "0",
      date = "",
      dept = "",
      category = "",
      type = "",
    } = req.query;

    const now = Date.now();

    // 🔄 Rafraîchir le cache si :
    //  - refresh=1
    //  - ou cache vide
    //  - ou cache trop vieux
    if (!CACHE.length || now - LAST_REFRESH > CACHE_DURATION || refresh === "1") {
      CACHE = await fetchAllTournaments();
      LAST_REFRESH = now;
    }

    // 🎯 Filtres en mémoire
    const filtered = CACHE.filter((t) => {
      if (date && t.tournament.startDate !== date) return false;

      if (dept) {
        const wanted = dept.split(",").map((d) => d.trim());
        if (!wanted.includes(t.club.department)) return false;
      }

      if (category) {
        const wanted = category
          .split(",")
          .map((c) => c.trim().toUpperCase());
        if (!wanted.includes(t.tournament.category)) return false;
      }

      if (type) {
        const wanted = type.split(",").map((x) => x.trim().toUpperCase());
        if (!wanted.includes((t.tournament.type || "").toUpperCase()))
          return false;
      }

      return true;
    });

    return res.status(200).json(filtered);
  } catch (e) {
    console.error("Proxy error:", e);
    return res.status(500).json({ error: "Proxy error", details: e.message });
  }
}

async function fetchAllTournaments() {
  let allHTML = "";
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page++) {
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

    // S’il n’y a plus de tournois, on arrête
    if (!html.includes("tournoi-item")) break;

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

function extractTournament(html) {
  // ---------- Nom / cat / type / date ----------
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  const category = extractCategory(fullName);
  const type = extractType(fullName);

  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  // ---------- Club ----------
  const clubName = get(
    html,
    /<div class="block-infos club">[\s\S]*?<a href="[^"]+" class="text">([\s\S]*?)<\/a>/
  );

  const rawClubAddress = get(
    html,
    /<div class="block-infos club">[\s\S]*?<img src="\/images\/adresse\.svg"[^>]*>[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );

  const clubPhone = get(
    html,
    /<div class="block-infos club">[\s\S]*?<img src="\/images\/phone\.svg"[^>]*>\s*<span class="text">([\s\S]*?)<\/span>/
  );

  // ---------- Organisateur (bloc "Informations d'inscription") ----------
  const organizerName = get(
    html,
    /<div class="registration-infos">[\s\S]*?<i class="fas fa-user"><\/i>\s*<span>\s*([\s\S]*?)\s*<\/span>/
  );

  const organizerEmail = get(
    html,
    /<div class="registration-infos">[\s\S]*?<i class="fas fa-at"><\/i>[\s\S]*?<a href="mailto:[^"]+">([^<]+)<\/a>/
  );

  const organizerPhone = get(
    html,
    /<div class="registration-infos">[\s\S]*?<i class="fas fa-phone-rotary"><\/i>[\s\S]*?<span>\s*([^<]+)\s*<\/span>/
  );

  const organizerAddress = get(
    html,
    /<div class="registration-infos">[\s\S]*?<i class="fas fa-map-marker-alt"><\/i>\s*<span>\s*([\s\S]*?)\s*<\/span>/
  );

  // ---------- Parsing des adresses ----------
  const {
    street: clubStreet,
    city: clubCity,
    department: clubDept,
  } = parseAddress(rawClubAddress);

  // 👉 ICI : on récupère le département depuis l'adresse organisateur si besoin
  const {
    street: orgStreet,
    city: orgCity,
    department: orgDept,
  } = parseAddress(organizerAddress);

  const department = clubDept || orgDept;

  if (!fullName || !isoDate) {
    return null;
  }

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
      street: clubStreet || rawClubAddress,
      city: clubCity || orgCity,
      department: department || "",
      phone: clubPhone || organizerPhone || "",
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone || "",
      address: organizerAddress,
    },
  };
}

// -------------- HELPERS --------------

function clean(str) {
  if (!str) return "";
  return str
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const cleanTxt = clean(text);

  // On cherche "XXXXX Ville..."
  const cpCity = cleanTxt.match(/(\d{5})\s+(.+)/);
  if (cpCity) {
    const cp = cpCity[1];
    return {
      street: cleanTxt
        .replace(cpCity[0], "")
        .replace(/[,;-]\s*$/, "")
        .trim(),
      city: cpCity[2].trim(),
      department: cp.substring(0, 2),
    };
  }

  // Pas de code postal trouvé
  return { street: cleanTxt, city: "", department: "" };
}

function extractCategory(title) {
  const m = title.match(/P\d+/i);
  if (m) return m[0].toUpperCase();
  return "LOISIR";
}

function extractType(title) {
  const t = (title || "").toLowerCase();
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

  const txt = text.toLowerCase();
  const m = txt.match(
    /(\d{1,2})\s+([a-zéûôùêîäëïöüç]+)\.?\s+(\d{4})/i
  );
  if (!m) return "";

  const day = String(parseInt(m[1], 10)).padStart(2, "0");
  const rawMonth = m[2]
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // enlever accents
  const month = months[rawMonth] || months[m[2]];

  if (!month) return "";

  const year = m[3];
  return `${year}-${month}-${day}`;
}
