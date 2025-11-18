// api/update-cache.js

// ⚠️ On NE met PAS l'import en haut pour pouvoir attraper les erreurs
// dans un try/catch (sinon Vercel renvoie juste une page 500 blanche).

export default async function handler(req, res) {
  try {
    // Import dynamique de @vercel/blob pour que les erreurs soient catchées
    const { put } = await import('@vercel/blob');

    // Sécurité : uniquement en GET
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }

    // 1. Récupération de TOUTES les pages de tournois
    let allHTML = '';
    const maxPages = 10;

    for (let page = 1; page <= maxPages; page++) {
      const resp = await fetch(
        `https://tournois.padelmagazine.fr/?lapage=${page}`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            Accept: 'text/html',
          },
        }
      );

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} sur la page ${page}`);
      }

      const html = await resp.text();

      // Si plus de bloc "tournoi-item", on s’arrête
      if (!html.includes('tournoi-item')) break;

      allHTML += html;
    }

    // 2. Extraction de tous les blocs de tournois
    const blockRegex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
    const tournaments = [];
    let m;

    while ((m = blockRegex.exec(allHTML)) !== null) {
      const parsed = extractTournament(m[0]);
      if (parsed) tournaments.push(parsed);
    }

    // 3. Sauvegarde dans le blob (fichier unique, sans suffixe aléatoire)
    const { url } = await put(
      'padel-cache/tournaments.json',
      JSON.stringify(tournaments),
      {
        access: 'public',
        addRandomSuffix: false,
      }
    );

    // 4. Réponse OK
    res.status(200).json({
      ok: true,
      count: tournaments.length,
      blobUrl: url,
    });
  } catch (err) {
    console.error('update-cache ERROR:', err);
    // Ici tu verras enfin le vrai message d’erreur dans le navigateur
    res.status(500).json({
      ok: false,
      error: err.message || String(err),
      stack: err.stack || null,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers de parsing (même logique que dans padel-proxy.js)         */
/* ------------------------------------------------------------------ */

function clean(str = '') {
  return str.replace(/\s+/g, ' ').trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : '';
}

function parseAddress(text) {
  if (!text) return { street: '', city: '', department: '' };

  const cleanTxt = clean(text);

  // cherche "CP Ville"
  const cpCity = cleanTxt.match(/(\d{5})\s+(.+)/);
  if (cpCity) {
    const cp = cpCity[1];
    return {
      street: cleanTxt.replace(cpCity[0], '').trim(),
      city: cpCity[2],
      department: cp.substring(0, 2),
    };
  }

  return { street: cleanTxt, city: '', department: '' };
}

function extractCategory(title) {
  const m = title.match(/P\d+/i);
  return m ? m[0].toUpperCase() : 'LOISIR';
}

function extractType(title) {
  const t = title.toLowerCase();
  if (t.includes('homme')) return 'H';
  if (t.includes('femme') || t.includes('dame')) return 'F';
  if (t.includes('mixte')) return 'M';
  return '';
}

function toISODate(text) {
  if (!text) return '';

  const months = {
    janv: '01',
    févr: '02',
    fevr: '02',
    mars: '03',
    avr: '04',
    mai: '05',
    juin: '06',
    juil: '07',
    août: '08',
    aout: '08',
    sept: '09',
    oct: '10',
    nov: '11',
    déc: '12',
    dec: '12',
  };

  const m = text.match(/(\d+)\s+([a-zéûô]+)\.?\s+(\d{4})/i);
  if (!m) return '';

  const day = String(m[1]).padStart(2, '0');
  const monthKey = m[2].toLowerCase();
  const month = months[monthKey] || '01';
  const year = m[3];

  return `${year}-${month}-${day}`;
}

function extractTournament(html) {
  // Nom
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : '';

  if (!fullName) return null;

  // Date (texte dans <span class="month">…</span>)
  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : '';

  // Club
  const clubName = get(html, /<a href="[^"]+" class="text">([\s\S]*?)<\/a>/);
  const rawAddress = get(
    html,
    /<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );
  const { street, city, department } = parseAddress(rawAddress);

  // Organisateur
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
      category: extractCategory(fullName),
      type: extractType(fullName),
      startDate: isoDate,
      endDate: isoDate,
    },
    club: {
      name: clubName,
      street,
      city,
      department,
      phone: organizerPhone || '',
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone,
    },
  };
}
