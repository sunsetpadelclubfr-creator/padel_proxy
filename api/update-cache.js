// api/update-cache.js

const BLOB_BASE_URL = process.env.BLOB_BASE_URL;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// ----------- HANDLER -----------
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  // Check config Blob
  if (!BLOB_BASE_URL || !BLOB_TOKEN) {
    console.error("Blob env manquantes", { BLOB_BASE_URL, hasToken: !!BLOB_TOKEN });
    return res
      .status(500)
      .json({ error: "Configuration Blob manquante (BLOB_BASE_URL ou BLOB_READ_WRITE_TOKEN)" });
  }

  try {
    // 1. On scrape tous les tournois (comme avant)
    const tournaments = await fetchAllTournaments();

    // 2. On stocke dans le Blob au format JSON
    const body = JSON.stringify({
      updatedAt: new Date().toISOString(),
      tournaments,
    });

    const putUrl = `${BLOB_BASE_URL}/tournaments.json`;

    const putResp = await fetch(putUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${BLOB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!putResp.ok) {
      const txt = await putResp.text().catch(() => "");
      console.error("Erreur PUT Blob", putResp.status, txt);
      return res
        .status(500)
        .json({ error: "Échec de l'écriture du cache dans Blob", status: putResp.status });
    }

    return res.status(200).json({
      ok: true,
      count: tournaments.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("update-cache ERROR", err);
    return res.status(500).json({ error: "Erreur serveur", details: err.message });
  }
}

// ----------- SCRAPING & PARSING -----------

async function fetchAllTournaments() {
  let allHTML = "";
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page++) {
    const resp = await fetch(`https://tournois.padelmagazine.fr/?lapage=${page}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html",
      },
    });

    const html = await resp.text();

    if (!html.includes("tournoi-item")) {
      break;
    }

    allHTML += html;
  }

  // Regex toujour la même qu'avant
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

function extractTournament(html) {
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  const category = extractCategory(fullName);
  const type = extractType(fullName);

  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  const clubName = get(html, /<a href="[^"]+" class="text">([\s\S]*?)<\/a>/);
  const rawAddress = get(
    html,
    /<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );

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

  if (!fullName || !isoDate || !clubName) return null;

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

// ----------- HELPERS -----------

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

function extractCategory(title = "") {
  const m = title.match(/P\d+/i);
  return m ? m[0].toUpperCase() : "LOISIR";
}

function extractType(title = "") {
  const t = title.toLowerCase();
  if (t.includes("homme")) return "H";
  if (t.includes("femme") || t.includes("dame")) return "F";
  if (t.includes("mixte")) return "M";
  return "";
}

function toISODate(text = "") {
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
  const month = months[monthKey];
  if (!month) return "";
  return `${m[3]}-${month}-${day}`;
}
