// api/update-cache.js
import { put } from "@vercel/blob";

const MAX_PAGES = 10; // nombre max de pages à charger (sécurité)

export default async function handler(req, res) {
  try {
    let allHTML = "";

    // 1. On scrape toutes les pages
    for (let page = 1; page <= MAX_PAGES; page++) {
      const upstream = await fetch(
        `https://tournois.padelmagazine.fr/?lapage=${page}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "text/html",
          },
        }
      );

      if (!upstream.ok) break;

      const html = await upstream.text();

      // s’il n’y a plus de blocs tournoi, on s’arrête
      if (!html.includes("tournoi-item")) break;

      allHTML += html;
    }

    // 2. On extrait tous les tournois
    const tournaments = extractAllTournaments(allHTML);

    // 3. On stocke le cache en JSON dans le Blob
    await put("tournaments.json", JSON.stringify(tournaments), {
      access: "public",
      contentType: "application/json",
    });

    res.status(200).json({
      ok: true,
      count: tournaments.length,
      message: "Cache mis à jour dans le Blob ✅",
    });
  } catch (err) {
    console.error("update-cache error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* ------------------------------------------------------------------
   Extraction de tous les tournois à partir du HTML global
-------------------------------------------------------------------*/
function extractAllTournaments(allHTML) {
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

/* ------------------------------------------------------------------
   extractTournament + helpers (reprend ta logique)
-------------------------------------------------------------------*/
function extractTournament(html) {
  // Nom du tournoi
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  if (!fullName) return null;

  // Catégorie (P25, P100, P250, etc.)
  const category = extractCategory(fullName);

  // Type (H, F, M, ou "")
  const type = extractType(fullName);

  // Date : on essaie d'abord h5.date-responsive, puis span.month
  const dateMatch =
    html.match(
      /<h5 class="date-responsive[^>]*>\s*([^<]+?)\s*<\/h5>/
    ) || html.match(/<span class="month">([^<]+)<\/span>/);

  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  // Club
  const clubName = get(
    html,
    /<div class="block-infos club">[\s\S]*?<a href="[^"]+" class="text">([\s\S]*?)<\/a>/
  );

  const clubPhone = get(
    html,
    /<img src="\/images\/phone\.svg"[^>]*>\s*<span class="text">\s*([\s\S]*?)\s*<\/span>/
  );

  const rawAddress = get(
    html,
    /<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">\s*([\s\S]*?)\s*<\/span>/
  );

  const { street, city, department } = parseAddress(rawAddress);

  // Organisateur (dans la partie "Informations d'inscription")
  const organizerName = get(
    html,
    /<i class="fas fa-user"><\/i>[\s\S]*?<span>\s*([\s\S]*?)\s*<\/span>/
  );

  const organizerEmail = get(
    html,
    /<i class="fas fa-at"><\/i>[\s\S]*?<a href="mailto:[^"]+">([^<]+)<\/a>/
  );

  const organizerPhone = get(
    html,
    /<i class="fas fa-phone-rotary"><\/i>[\s\S]*?<span>\s*([^<]+?)\s*<\/span>/
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
      department, // très important pour tes filtres département
      phone: clubPhone || organizerPhone || "",
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone,
    },
  };
}

/* -------------------- Helpers -------------------- */
function clean(str = "") {
  return str.replace(/\s+/g, " ").replace(/&nbsp;/g, " ").trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : "";
}

function parseAddress(text) {
  if (!text) return { street: "", city: "", department: "" };

  const cleanTxt = clean(text);

  // On recherche un CP à 5 chiffres + Ville (ex : "62200 BOULOGNE SUR MER")
  const cpCity = cleanTxt.match(/(\d{5})\s+(.+)/);
  if (cpCity) {
    const cp = cpCity[1];
    return {
      street: cleanTxt.replace(cpCity[0], "").trim(),
      city: cpCity[2],
      department: cp.substring(0, 2), // 62200 -> "62"
    };
  }

  // sinon, on garde tout dans street
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
    déc: "12",
    dec: "12",
    décembre: "12",
    decembre: "12",
  };

  const m = text
    .toLowerCase()
    .replace(/\./g, "")
    .match(/(\d{1,2})\s+([a-zéûôàèùîïüç]+)\s+(\d{4})/i);

  if (!m) return "";

  const day = String(parseInt(m[1], 10)).padStart(2, "0");
  const monthKey = m[2].toLowerCase();
  const year = m[3];

  const month = months[monthKey];
  if (!month) return "";

  return `${year}-${month}-${day}`;
}
