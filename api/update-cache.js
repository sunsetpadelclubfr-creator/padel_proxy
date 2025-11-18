// api/update-cache.js
import { put } from "@vercel/blob";

// ---------- Helpers communs ----------

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

  // ex : "Hameau de Terlincthun, 62200 BOULOGNE SUR MER"
  const cpCity = cleanTxt.match(/(\d{5})\s+(.+)/);
  if (cpCity) {
    const cp = cpCity[1];
    return {
      street: cleanTxt.replace(cpCity[0], "").replace(/,\s*$/, "").trim(),
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
  // Devrait matcher des choses comme "17 novembre 2025"
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

  const m = text
    .toLowerCase()
    .match(/(\d{1,2})\s+([a-zéûôùî]+)\s+(\d{4})/i);
  if (!m) return "";

  const day = String(m[1]).padStart(2, "0");
  const monthKey = m[2].toLowerCase();
  const month = months[monthKey] || "01";
  const year = m[3];

  return `${year}-${month}-${day}`;
}

function extractTournament(html) {
  // Nom du tournoi
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  // Date (sur mobile c’est dans <h5 class="date-responsive ...">)
  const dateMatch =
    html.match(/<h5 class="date-responsive[^>]*>([\s\S]*?)<\/h5>/) ||
    html.match(/<span class="month">([\s\S]*?)<\/span>/);

  const isoDate = dateMatch ? toISODate(clean(dateMatch[1])) : "";

  // Club & coordonnées
  const clubName = get(
    html,
    /<div class="block-infos club">[\s\S]*?<a href="[^"]+" class="text">([\s\S]*?)<\/a>/
  );
  const clubPhone = get(
    html,
    /<img src="\/images\/phone\.svg"[^>]*>\s*<span class="text">\s*([^<]*)<\/span>/
  );
  const rawAddress = get(
    html,
    /<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">\s*([\s\S]*?)<\/span>/
  );

  const { street, city, department } = parseAddress(rawAddress);

  // Organisateur (dans l’accordéon)
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
    /<i class="fas fa-phone-rotary"><\/i>[\s\S]*?<span>\s*([^<]+)\s*<\/span>/
  );

  const category = extractCategory(fullName);
  const type = extractType(fullName);

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
      phone: organizerPhone || "",
    },
  };
}

function parseAllTournaments(allHTML) {
  const regex =
    /<div class="tournoi-item"[\s\S]*?class="accordion-item">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;

  const tournaments = [];
  let match;
  while ((match = regex.exec(allHTML)) !== null) {
    const block = match[0];
    const t = extractTournament(block);
    if (t && t.tournament && t.tournament.name) {
      tournaments.push(t);
    }
  }
  return tournaments;
}

// ---------- Handler principal ----------

export default async function handler(req, res) {
  try {
    let allHTML = "";

    // On charge jusqu’à 10 pages tant qu’il y a des "tournoi-item"
    for (let page = 1; page <= 10; page++) {
      const resp = await fetch(
        `https://tournois.padelmagazine.fr/?lapage=${page}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; padel-proxy/1.0; +https://padel-proxy.vercel.app)",
            Accept: "text/html",
          },
        }
      );

      if (!resp.ok) {
        throw new Error(`Upstream HTTP ${resp.status} on page ${page}`);
      }

      const html = await resp.text();

      if (!html.includes("tournoi-item")) {
        break; // plus de tournois -> on arrête
      }

      allHTML += html;
    }

    const tournaments = parseAllTournaments(allHTML);
    console.log("Parsed tournaments:", tournaments.length);

    // Sauvegarde dans le Blob (si le token est bien présent)
    let blobInfo = null;
    try {
      blobInfo = await put(
        "padel-cache/tournaments.json",
        JSON.stringify(tournaments),
        {
          access: "public",
          addRandomSuffix: false,
          contentType: "application/json",
        }
      );
      console.log("Blob saved at:", blobInfo.url);
    } catch (blobErr) {
      console.error("Blob save failed:", blobErr);
      // On ne jette pas l’erreur pour que l’API réponde quand même
    }

    return res.status(200).json({
      ok: true,
      count: tournaments.length,
      blobUrl: blobInfo?.url || null,
    });
  } catch (err) {
    console.error("update-cache ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Unknown error",
    });
  }
}
