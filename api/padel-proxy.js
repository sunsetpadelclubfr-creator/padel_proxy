// api/padel-proxy.js

// URL publique de ton Blob (base), à ajuster si besoin
const BLOB_BASE_URL =
  process.env.BLOB_BASE_URL ||
  'https://q2tzmq6opef1lix1.public.blob.vercel-storage.com';

const CACHE_PATH = 'padel-cache/tournaments.json';

export default async function handler(req, res) {
  // CORS basique
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const { date = '', dept = '', category = '', type = '' } = req.query;

  try {
    // 1) On récupère le JSON en direct depuis le blob public
    const url = `${BLOB_BASE_URL.replace(/\/$/, '')}/${CACHE_PATH}`;

    const upstream = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!upstream.ok) {
      throw new Error(`Blob fetch failed: ${upstream.status} ${upstream.statusText}`);
    }

    const data = await upstream.json();
    const tournaments = data.tournaments || [];

    // 2) Filtres côté serveur
    const filtered = tournaments.filter((t) => {
      if (date && t.tournament.startDate !== date) return false;

      if (dept) {
        const wanted = dept.split(',');
        if (!wanted.includes(t.club.department)) return false;
      }

      if (category) {
        const wanted = category.split(',');
        if (!wanted.includes(t.tournament.category)) return false;
      }

      if (type) {
        const wanted = type.split(',');
        if (!wanted.includes(t.tournament.type)) return false;
      }

      return true;
    });

    return res.status(200).json(filtered);
  } catch (err) {
    console.error('❌ Error in padel-proxy:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Unknown error'
    });
  }
}
