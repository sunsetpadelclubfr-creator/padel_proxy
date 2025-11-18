// api/update-cache.js
//
// Cette version évite tout import au niveau du module pour @vercel/blob,
// afin que les erreurs soient CATCHÉES dans la fonction et renvoyées en JSON.
//

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
      street: cleanTxt
        .replace(cpCity[0], "")
        .replace(/,\s*$/, "")
        .trim(),
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
  // Nom
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : "";

  // Date (mobile : <h5 class="date-responsive">…</h5>)
  const dateMatch =
    html.match(/<h5 class="date-responsive[^>]*>([\s\S]*?)<\/h5>/) ||
    html.match(/<span class="month">([\s\S]*?)<\/span>/);

  const isoDate = dateMatch ? toISODate(clean(dateMatch[1])) : "";

  // Club
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

  // Organisateur
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
  res.setHeader("Content-Type", "application/json");

  try {
    // 1) Import dynamique de @vercel/blob pour catcher les erreurs
    let put;
    try {
      const blobMod = await import("@vercel/blob");
      put = blobMod.put;
    } catch (e) {
      // Ici, tu verras clairement si @vercel/blob n'est pas installé
      return res.status(500).json({
        ok: false,
        step: "import-blob",
        error: "Impossible de charger @vercel/blob",
        details: e.message,
      });
    }

    // 2) Scraper toutes les pages de tournois
    let allHTML = "";
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
        return res.status(500).json({
          ok: false,
          step: "fetch-upstream",
          error: `HTTP ${resp.status} sur la page ${page}`,
        });
      }

      const html = await resp.text();

      if (!html.includes("tournoi-item")) {
        break; // plus de tournois
      }

      allHTML += html;
    }

    const tournaments = parseAllTournaments(allHTML);

    // 3) Sauvegarde dans le Blob
    try {
      const blobInfo = await put(
        "padel-cache/tournaments.json",
        JSON.stringify(tournaments),
        {
          access: "public",
          addRandomSuffix: false,
          contentType: "application/json",
        }
      );

      return res.status(200).json({
        ok: true,
        step: "done",
        count: tournaments.length,
        blobUrl: blobInfo.url,
        hasToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch (e) {
      // Erreur d'écriture dans le Blob (souvent token manquant/mauvais)
      return res.status(500).json({
        ok: false,
        step: "blob-put",
        error: e.message,
        hint:
          "Vérifie que BLOB_READ_WRITE_TOKEN est bien défini pour le projet padel-proxy (Production + Preview + Development).",
        hasToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      });
    }
  } catch (err) {
    console.error("update-cache ERROR:", err);
    return res.status(500).json({
      ok: false,
      step: "global",
      error: err.message || "Unknown error",
    });
  }
}
