export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  const { date = "", dept = "", category = "", type = "" } = req.query;

  try {
    let allHTML = "";
    let page = 1;
    let maxPages = 10; // sécurité

    // 🟧 1 — On charge TOUTES LES PAGES
    while (page <= maxPages) {
      const upstream = await fetch(`https://tournois.padelmagazine.fr/?lapage=${page}`, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "text/html",
        },
      });

      const html = await upstream.text();

      // Stop si une page ne contient pas de tournoi
      if (!html.includes("tournoi-item")) break;

      allHTML += html;
      page++;
    }

    // 🟧 2 — REGEX robuste pour ATTRAPER TOUS les tournois
    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;

    const tournaments = [];
    let match;

    // 🟧 3 — Extraction de CHAQUE tournoi
    while ((match = regex.exec(allHTML)) !== null) {
      const block = match[0];

      const parsed = extractTournament(block);
      if (!parsed) continue;

      tournaments.push(parsed);
    }

    // 🟧 4 — POST-FILTRES (appliqués APRÈS extraction)
    const filtered = tournaments.filter((t) => {
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

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(filtered);
  } catch (err) {
    console.error(err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: "Proxy error", details: err.message });
  }
}

//
// -------------- PARSING TOURNAMENT --------------
//
function extractTournament(html) {
  // Nom
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  // Catégorie
  const category = extractCategory(fullName);

  // Type
  const type = extractType(fullName);

  // Date
  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  // Club
  const clubName = get(html, /<a href="[^"]+" class="text">([\s\S]*?)<\/a>/);
  const clubPhone = get(html, /<img src="\/images\/phone\.svg"[^>]*>\s*<span class="text">([\s\S]*?)<\/span>/);
  const rawAddress = get(html, /<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">([\s\S]*?)<\/span>/);

  const { street, city, department } = parseAddress(rawAddress);

  // Organisateur
  const organizerName = get(html, /<i class="fas fa-user"><\/i>[\s\S]*?<span>([\s\S]*?)<\/span>/);
  const organizerEmail = get(html, /<i class="fas fa-at"><\/i>[\s\S]*?<a href="mailto:[^"]+">([^<]+)<\/a>/);
  const organizerPhone = get(html, /<i class="fas fa-phone-rotary"><\/i>[\s\S]*?<span>([^<]+)<\/span>/);

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

//
// -------------- HELPERS --------------
//
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

  // Regex CP + Ville
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

function toISODate(text) {
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
    sept: "09",
    oct: "10",
    nov: "11",
    déc: "12",
  };

  const m = text.match(/(\d+)\s+([a-zéûô]+)\.?\s+(\d{4})/i);
  if (!m) return "";

  return `${m[3]}-${months[m[2].toLowerCase()]}-${String(m[1]).padStart(2, "0")}`;
}
