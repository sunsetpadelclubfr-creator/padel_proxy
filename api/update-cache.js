// api/update-cache.js
import { put } from "@vercel/blob";

const MAX_PAGES = 10; // max de pages à scraper

export default async function handler(req, res) {
  try {
    console.log("⬆️ update-cache called");

    let allHTML = "";

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `https://tournois.padelmagazine.fr/?lapage=${page}`;
      console.log("Fetching page:", url);

      const upstream = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "text/html",
        },
      });

      if (!upstream.ok) {
        console.log("Stop, status:", upstream.status);
        break;
      }

      const html = await upstream.text();

      if (!html.includes("tournoi-item")) {
        console.log("No tournoi-item on page -> stop at page", page);
        break;
      }

      allHTML += html;
    }

    const tournaments = extractAllTournaments(allHTML);
    console.log("Extracted tournaments:", tournaments.length);

    // Stockage dans le Blob
    const json = JSON.stringify(tournaments);
    const result = await put("tournaments.json", json, {
      access: "public",
      contentType: "application/json",
    });

    console.log("Blob written at URL:", result.url);

    return res.status(200).json({
      ok: true,
      count: tournaments.length,
      blobUrl: result.url,
    });
  } catch (err) {
    console.error("❌ update-cache error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Unknown error" });
  }
}

/* ---------- extraction globale ---------- */
function extractAllTournaments(allHTML) {
  if (!allHTML) return [];
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

/* ---------- extractTournament + helpers ---------- */
function extractTournament(html) {
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";
  if (!fullName) return null;

  const category = extractCategory(fullName);
  const type = extractType(fullName);

  const dateMatch =
    html.match(
      /<h5 class="date-responsive[^>]*>\s*([^<]+?)\s*<\/h5>/
    ) || html.match(/<span class="month">([^<]+)<\/span>/);

  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

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
