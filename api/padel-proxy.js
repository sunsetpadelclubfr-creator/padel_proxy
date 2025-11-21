import fs from "fs";

// Chargement du cache GitHub local
let CACHE = null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    if (!CACHE) {
      const json = fs.readFileSync("data/tournaments.json", "utf8");
      CACHE = JSON.parse(json);
    }

    return res.status(200).json(CACHE);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur API", details: err.message });
  }
}
