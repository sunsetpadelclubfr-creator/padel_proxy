export default async function handler(req, res) {
  // Gérer le préflight CORS (au cas où)
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(200).end();
    return;
  }

  const { date, dept = "", category = "", type = "" } = req.query || {};

  try {
    // Exemple : on appelle la page des tournois Padel Magazine
    // (à adapter plus tard si on veut vraiment parser le HTML)
    const upstream = await fetch("https://tournois.padelmagazine.fr/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PadelProxy/1.0; +https://example.com)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    // On lit le HTML, mais on ne le parse pas encore
    const html = await upstream.text();

    // 👉 TODO plus tard : parser `html` pour extraire les vrais tournois.
    // Pour l’instant, on renvoie des FAKE DATA filtrées par date/filters
    const tournaments = getFakeTournaments(date, { dept, category, type });

    // Réponse JSON + CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    res.status(200).json(tournaments);
  } catch (e) {
    console.error("Erreur proxy:", e);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({
      error: "Proxy error",
      details: e.message
    });
  }
}

// ------- Données de test (même format que ton front-end) -------

function getFakeTournaments(dateStr, filters) {
  // si aucune date fournie, on met une date par défaut
  const date = dateStr || "2025-12-28";

  const sample = [
    {
      id: "1",
      name: "TENNIS CLUB DE PAU",
      club: "Tennis Club de Pau",
      city: "Pau",
      department: "64",
      category: "P25",
      type: "M", // Mixte
      startDate: date,
      endDate: date,
      logoUrl: null
    },
    {
      id: "2",
      name: "PADEL FACTORY",
      club: "Padel Factory",
      city: "Pau",
      department: "64",
      category: "P100",
      type: "H", // Hommes
      startDate: date,
      endDate: date,
      logoUrl: null
    },
    {
      id: "3",
      name: "WA PADEL",
      club: "WA Padel",
      city: "Tarbes",
      department: "65",
      category: "P25",
      type: "M",
      startDate: date,
      endDate: date,
      logoUrl: null
    },
    {
      id: "4",
      name: "LEGEND PADEL",
      club: "Legend Padel",
      city: "Tarbes",
      department: "65",
      category: "P100",
      type: "H",
      startDate: date,
      endDate: date,
      logoUrl: null
    }
  ];

  return sample.filter((t) => {
    if (filters.dept && t.department !== filters.dept) return false;
    if (filters.category && t.category !== filters.category) return false;
    if (filters.type && t.type !== filters.type) return false;
    return true;
  });
}

