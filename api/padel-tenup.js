// api/padel-tenup.js

let CACHE = null;
let CACHE_TIME = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6h

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  const { date = "", dept = "", category = "", type = "" } = req.query;

  const forceRefresh = req.query.refresh === "1";

  // 1. On sert le cache si valide et pas de refresh forcé
  if (!forceRefresh && CACHE && Date.now() - CACHE_TIME < CACHE_DURATION) {
    const filtered = applyFilters(CACHE, { date, dept, category, type });
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(filtered);
  }

  try {
    // 2. Appel Tenup (à adapter à l’URL réelle de leur API)
    // Exemple d’URL : à remplacer par la bonne quand tu l’auras
    const upstream = await fetch(
      "https://api.tenup.fft.fr/tournois-padel?limit=5000",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
        },
      }
    );

    if (!upstream.ok) {
      throw new Error(`Tenup error: ${upstream.status}`);
    }

    const raw = await upstream.json();

    // 3. Normalisation du format en notre structure commune
    const tournaments = normalizeTenup(raw);

    // 4. Mise en cache
    CACHE = tournaments;
    CACHE_TIME = Date.now();

    // 5. Post-filtres
    const filtered = applyFilters(tournaments, { date, dept, category, type });

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(filtered);
  } catch (err) {
    console.error(err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "Tenup proxy error", details: err.message });
  }
}

//
// -------------- NORMALISATION TENUP → FORMAT COMMUN --------------
//
function normalizeTenup(raw) {
  // ici on suppose que Tenup renvoie un tableau d’objets
  // Il faudra ajuster les chemins exacts (raw.data, raw.items, etc.)
  const list = Array.isArray(raw) ? raw : raw.data || raw.items || [];

  return list.map((item) => {
    // ⚠️ ADAPTER ces chemins quand tu verras la vraie structure Tenup
    const name = item.nom || item.name || "";
    const category = item.categorie || item.category || "";
    const type = normalizeType(item.typeEpreuve || item.type || "");
    const startDate = toISODateTenup(item.dateDebut || item.startDate);
    const endDate = toISODateTenup(item.dateFin || item.endDate || startDate);

    const clubName =
      item.clubNom ||
      item.club?.nom ||
      item.club?.name ||
      "";
    const street =
      item.clubAdresse ||
      item.club?.adresse ||
      "";
    const city =
      item.clubVille ||
      item.club?.ville ||
      "";
    const postalCode =
      item.clubCodePostal ||
      item.club?.codePostal ||
      "";
    const department = postalCode ? postalCode.substring(0, 2) : "";

    const organizerName =
      item.organisateur ||
      item.organizer?.nom ||
      "";
    const organizerEmail =
      item.organisateurEmail ||
      item.organizer?.email ||
      "";
    const organizerPhone =
      item.organisateurTelephone ||
      item.organizer?.telephone ||
      "";

    return {
      tournament: {
        id: `${name}_${startDate}_${clubName}`.replace(/\s+/g, "_"),
        name,
        category: normalizeCategory(category),
        type,
        startDate,
        endDate,
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
  });
}

//
// -------------- FILTRES --------------
function applyFilters(tournaments, { date, dept, category, type }) {
  return tournaments.filter((t) => {
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
}

//
// -------------- HELPERS --------------
function normalizeCategory(cat) {
  if (!cat) return "LOISIR";
  const upper = cat.toString().toUpperCase();
  const m = upper.match(/P\d+/);
  return m ? m[0] : upper;
}

function normalizeType(t) {
  if (!t) return "";
  const s = t.toString().toLowerCase();
  if (s.includes("homme") || s.includes("m") || s === "h") return "H";
  if (s.includes("femme") || s.includes("dame") || s === "f") return "F";
  if (s.includes("mixte")) return "M";
  return "";
}

function toISODateTenup(value) {
  if (!value) return "";
  // Si Tenup renvoie déjà du ISO yyyy-mm-dd → on laisse
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  // Si Tenup renvoie "2025-11-18T00:00:00" → on découpe
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];

  // Dernier recours : on tente new Date
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}
