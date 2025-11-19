// api/update-cache.js

const MAX_PAGES = 10; // nombre max de pages à scraper

// on garde une référence sur put pour ne pas ré-importer à chaque appel
let putFn = null;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // 🔹 import dynamique de @vercel/blob
    if (!putFn) {
      try {
        const mod = await import("@vercel/blob");
        if (!mod.put) {
          throw new Error(
            "Le module @vercel/blob ne contient pas de fonction 'put'"
          );
        }
        putFn = mod.put;
      } catch (e) {
        console.error("Erreur import @vercel/blob:", e);
        return res.status(500).json({
          error: "Import @vercel/blob failed",
          message: e.message,
        });
      }
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      console.error(
        "BLOB_READ_WRITE_TOKEN manquant dans les variables d'environnement"
      );
      return res.status(500).json({
        error: "Missing BLOB_READ_WRITE_TOKEN env var",
      });
    }

    // -------- SCRAPING --------
    let allHTML = "";

    for (let page = 1; page <= MAX_PAGES; page++) {
      const resp = await fetch(
        `https://tournois.padelmagazine.fr/?lapage=${page}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "text/html",
          },
        }
      );

      if (!resp.ok) {
        throw new Error(`Upstream HTTP ${resp.status}`);
      }

      const html = await resp.text();

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

    const body = JSON.stringify(tournaments);

    // -------- ÉCRITURE DANS LE BLOB --------
    let url;
    try {
      const result = await putFn("padel-cache/tournaments.json", body, {
        access: "public",
        addRandomSuffix: false,
        token,
      });
      url = result.url;
    } catch (e) {
      console.error("Erreur put() vers Blob:", e);
      return res.status(500).json({
        error: "Blob put failed",
        message: e.message,
      });
    }

    console.log(
      "Cache mis à jour",
      url,
      "tournois:",
      tournaments.length
    );

    return res.status(200).json({
      ok: true,
      count: tournaments.length,
      url,
    });
  } catch (err) {
    console.error("update-cache error (catch global):", err);
    return res.status(500).json({
      error: "Failed to update cache",
      message: err.message,
    });
  }
}

/* ----------------- HELPERS PARSING ----------------- */

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
    aout: "08",
    sept: "09",
    oct: "10",
    nov: "11",
    déc: "12",
    dec: "12",
  };

  const m = text.match(
    /(\d+)\s+([a-zéûôùî]+)\.?\s+(\d{4})/i
  );
  if (!m) return "";

  const day = String(m[1]).padStart(2, "0");
  const monthKey = m[2].toLowerCase();
  const month = months[monthKey] || "01";
  const year = m[3];

  return `${year}-${month}-${day}`;
}

function extractTournament(html) {
  const nameMatch = html.match(
    /<h4 class="name">([\s\S]*?)<\/h4>/
  );
  const fullName = nameMatch ? clean(nameMatch[1]) : "";
  if (!fullName) return null;

  const category = extractCategory(fullName);
  const type = extractType(fullName);

  const dateMatch = html.match(
    /<span class="month">([^<]+)<\/span>/
  );
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : "";

  const clubName = get(
    html,
    /<a href="[^"]+" class="text">([\s\S]*?)<\/a>/
  );
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
