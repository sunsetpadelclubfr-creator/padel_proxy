export default async function handler(req, res) {
  // CORS
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  const { date, dept = "", category = "", type = "" } = req.query;

  try {
    // Fetch page
    const upstream = await fetch("https://tournois.padelmagazine.fr/", {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
    });
    const html = await upstream.text();

    // Full block regex
    const regex = /<div class="tournoi-item">([\s\S]*?)<\/div>\s*<\/div>/g;
    const tournaments = [];

    let match;
    while ((match = regex.exec(html)) !== null) {
      const block = match[0];
      const parsed = parseBlock(block);
      if (!parsed) continue;

      // Apply filters
      if (date && parsed.tournament.startDate !== date) continue;
      if (dept && parsed.club.department !== dept) continue;
      if (category && parsed.tournament.category !== category) continue;
      if (type && parsed.tournament.type !== type) continue;

      tournaments.push(parsed);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(tournaments);
  } catch (err) {
    console.error(err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: err.message });
  }
}

function parseBlock(html) {
  try {
    // ------ Title ------
    const nameMatch = html.match(/<h4 class="name">([^<]+)<\/h4>/);
    if (!nameMatch) return null;
    const fullName = clean(nameMatch[1]);

    const category = extractCategory(fullName);
    const type = extractType(fullName);

    // ------ Date ------
    const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
    const dateText = dateMatch ? clean(dateMatch[1]) : "";
    const isoDate = toISODate(dateText);

    // ------ Club ------
    const clubNameMatch = html.match(/<a href="([^"]+)" class="text">([^<]+)<\/a>/);
    const clubUrl = clubNameMatch ? clubNameMatch[1] : "";
    const clubName = clubNameMatch ? clean(clubNameMatch[2]) : "";

    const phoneMatch = html.match(/<img src="\/images\/phone.svg"[^>]*>\s*<span class="text">\s*([^<]+)/);
    const clubPhone = phoneMatch ? clean(phoneMatch[1]) : "";

    const addressMatch = html.match(/<img src="\/images\/adresse.svg"[^>]*>\s*<span class="text">\s*([\s\S]*?)<\/span>/);
    let rawAddress = addressMatch ? clean(addressMatch[1]) : "";
    let street = "";
    let city = "";
    let department = "";

    if (rawAddress) {
      const parts = rawAddress.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
      if (parts.length === 2) {
        street = parts[0];
        city = parts[1];
      } else {
        // fallback
        city = rawAddress;
      }

      // Extract CP
      const cpMatch = rawAddress.match(/\b(\d{5})\b/);
      if (cpMatch) department = cpMatch[1].substring(0, 2);
    }

    // ------ Organizer ------
    const orgNameMatch = html.match(/<i class="fas fa-user"><\/i>\s*<span>\s*([\s\S]*?)<\/span>/);
    const organizerName = orgNameMatch ? clean(orgNameMatch[1]) : "";

    const orgEmailMatch = html.match(/<i class="fas fa-at"><\/i>[\s\S]*?mailto:([^"]+)/);
    const organizerEmail = orgEmailMatch ? clean(orgEmailMatch[1]) : "";

    const orgPhoneMatch = html.match(/<i class="fas fa-phone-rotary"><\/i>\s*<span>\s*([^<]+)/);
    const organizerPhone = orgPhoneMatch ? clean(orgPhoneMatch[1]) : "";

    const orgAddressMatch = html.match(/<i class="fas fa-map-marker-alt"><\/i>\s*<span>\s*([\s\S]*?)<\/span>/);
    let orgAddress = orgAddressMatch ? clean(orgAddressMatch[1]) : "";
    let orgCity = "";
    let orgZip = "";
    let orgDept = "";

    if (orgAddress) {
      const cp = orgAddress.match(/\b(\d{5})\b/);
      if (cp) {
        orgZip = cp[1];
        orgDept = cp[1].substring(0, 2);
      }
      const parts = orgAddress.split(/\s{2,}/);
      if (parts.length >= 2) orgCity = clean(parts[parts.length - 1]);
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
        url: clubUrl,
        phone: clubPhone,
        street,
        city,
        department,
        fullAddress: rawAddress,
      },
      organizer: {
        name: organizerName,
        email: organizerEmail,
        phone: organizerPhone,
        zipcode: orgZip,
        city: orgCity,
        department: orgDept,
        fullAddress: orgAddress,
      },
    };
  } catch (e) {
    console.error("Parse error:", e);
    return null;
  }
}

// -----------------------------------------------
// Helpers
// -----------------------------------------------
function clean(str) {
  return str.replace(/\s+/g, " ").trim();
}

function extractCategory(title) {
  const match = title.match(/P\d+/i);
  return match ? match[0].toUpperCase() : "LOISIR";
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
    janv: "01", févr: "02", fév: "02",
    mars: "03", avr: "04", mai: "05",
    juin: "06", juil: "07", août: "08",
    sept: "09", oct: "10", nov: "11",
    déc: "12"
  };

  const m = text.match(/(\d{1,2})\s+([A-Za-zéû\.]+)\s+(\d{4})/);
  if (!m) return "";

  const day = m[1].padStart(2, "0");
  const monthTxt = m[2].replace(".", "");
  const month = months[monthTxt] || "01";
  const year = m[3];

  return `${year}-${month}-${day}`;
}
