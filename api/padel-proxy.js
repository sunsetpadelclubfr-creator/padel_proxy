export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  const { date, dept = "", category = "", type = "" } = req.query;

  try {
    const upstream = await fetch("https://tournois.padelmagazine.fr/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (PadelProxyApp/1.0)",
        Accept: "text/html",
      },
    });

    const html = await upstream.text();

    const regex = /<div class="tournoi-item">([\s\S]*?)<\/div>\s*<\/div>/g;

    const tournaments = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      const block = match[0];

      const t = extractTournament(block);
      if (!t) continue;

      if (date && t.startDate !== date) continue;
      if (dept && t.department !== dept) continue;
      if (category && t.category !== category) continue;
      if (type && t.type !== type) continue;

      tournaments.push(t);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(tournaments);
  } catch (err) {
    console.error(err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: "Proxy error", details: err.message });
  }
}

function extractTournament(html) {
  const nameMatch = html.match(/<h4 class="name">([^<]+)<\/h4>/);
  if (!nameMatch) return null;

  const fullName = clean(nameMatch[1]);
  const category = extractCategory(fullName);
  const type = extractType(fullName);

  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const dateText = dateMatch ? clean(dateMatch[1]) : "";
  const isoDate = toISODate(dateText);

  const clubMatch = html.match(/<a href="[^"]+" class="text">([^<]+)<\/a>/);
  const club = clubMatch ? clean(clubMatch[1]) : "";

  const cityMatch = html.match(/<img src="\/images\/adresse.svg"[^>]*>\s*<span class="text">\s*([^<]+)/);
  const city = cityMatch ? clean(cityMatch[1]) : "";

  const cpMatch = html.match(/\b(\d{5})\b/);
  const department = cpMatch ? cpMatch[1].substring(0, 2) : "";

  return {
    id: `${fullName}_${isoDate}_${club}`,
    name: fullName,
    club,
    city,
    department,
    category,
    type,
    startDate: isoDate,
    endDate: isoDate,
    logoUrl: null,
  };
}

function clean(str) {
  return str.replace(/\s+/g, " ").trim();
}

function extractCategory(title) {
  const m = title.match(/P\d+/i);
  return m ? m[0].toUpperCase() : "LOISIR";
}

function extractType(title) {
  title = title.toLowerCase();
  if (title.includes("homme")) return "H";
  if (title.includes("femme") || title.includes("dame")) return "F";
  if (title.includes("mixte")) return "M";
  if (title.includes("jeune")) return "J";
  return "";
}

function toISODate(text) {
  if (!text) return "";

  const months = {
    janv: "01",
    févr: "02",
    fév: "02",
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

  const m = text.match(/(\d{1,2})\s+([A-Za-zéû\.]+)\s+(\d{4})/);
  if (!m) return "";

  const d = m[1].padStart(2, "0");
  const monthTxt = m[2].replace(".", "");
  const month = months[monthTxt] || "01";
  const year = m[3];

  return `${year}-${month}-${d}`;
}
