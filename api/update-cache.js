// api/update-cache.js
import { put } from '@vercel/blob';

const MAX_PAGES = 10;
const SOURCE_URL = 'https://tournois.padelmagazine.fr/?lapage=';

/**
 * Route appelée par le cron (ou manuellement) pour :
 * 1) scraper les tournois
 * 2) les parser
 * 3) les stocker dans le Blob en JSON
 */
export default async function handler(req, res) {
  try {
    // 🔎 debug simple : vérifier que le token Blob est bien présent
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('❌ BLOB_READ_WRITE_TOKEN manquant dans les variables d’environnement.');
      return res
        .status(500)
        .json({ ok: false, error: 'BLOB_READ_WRITE_TOKEN is missing in environment variables' });
    }

    // 1) On charge toutes les pages HTML
    let allHTML = '';
    for (let page = 1; page <= MAX_PAGES; page++) {
      const upstream = await fetch(`${SOURCE_URL}${page}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
          Accept: 'text/html'
        }
      });

      if (!upstream.ok) {
        throw new Error(`Upstream ${upstream.status} on page ${page}`);
      }

      const html = await upstream.text();

      // Si plus de "tournoi-item" → on considère qu’il n’y a plus de pages
      if (!html.includes('tournoi-item')) break;

      allHTML += html;
    }

    // 2) On extrait les tournois avec la regex + parsing
    const tournaments = [];
    const regex = /<div class="tournoi-item"[\s\S]*?class="accordion-item">/g;
    let match;

    while ((match = regex.exec(allHTML)) !== null) {
      const block = match[0];
      const parsed = extractTournament(block);
      if (parsed) tournaments.push(parsed);
    }

    // 3) On stocke dans le Blob sous forme JSON
    const payload = JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        count: tournaments.length,
        tournaments
      },
      null,
      2
    );

    const { url } = await put('padel-cache/tournaments.json', payload, {
      access: 'public',
      contentType: 'application/json'
    });

    console.log('✅ Cache updated. Blob URL:', url);

    return res.status(200).json({
      ok: true,
      count: tournaments.length,
      url
    });
  } catch (err) {
    console.error('❌ Error in update-cache:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Unknown error',
      stack: err.stack
    });
  }
}

/**
 * --------- HELPERS DE PARSING ----------
 */

function clean(str) {
  return str.replace(/\s+/g, ' ').trim();
}

function get(html, regex) {
  const m = html.match(regex);
  return m ? clean(m[1]) : '';
}

function parseAddress(text) {
  if (!text) return { street: '', city: '', department: '' };

  const cleanTxt = clean(text);

  // ex : "213 rue machin 75015 PARIS"
  const cpCity = cleanTxt.match(/(\d{5})\s+(.+)/);
  if (cpCity) {
    const cp = cpCity[1];
    return {
      street: cleanTxt.replace(cpCity[0], '').trim(),
      city: cpCity[2],
      department: cp.substring(0, 2)
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
    dec: '12'
  };

  const m = text.match(/(\d+)\s+([a-zéûôêîùàç]+)\.?\s+(\d{4})/i);
  if (!m) return '';

  const day = String(m[1]).padStart(2, '0');
  const monthKey = m[2].toLowerCase();
  const month = months[monthKey] || '01';
  const year = m[3];

  return `${year}-${month}-${day}`;
}

function extractTournament(html) {
  // Nom complet
  const nameMatch = html.match(/<h4 class="name">([\s\S]*?)<\/h4>/);
  const fullName = nameMatch ? clean(nameMatch[1]) : '';

  if (!fullName) return null;

  // Catégorie / Type / Date
  const category = extractCategory(fullName);
  const type = extractType(fullName);

  const dateMatch = html.match(/<span class="month">([^<]+)<\/span>/);
  const isoDate = dateMatch ? toISODate(dateMatch[1]) : '';

  // Club
  const clubName = get(html, /<a href="[^"]+" class="text">([\s\S]*?)<\/a>/);
  const addressRaw = get(
    html,
    /<img src="\/images\/adresse\.svg"[\s\S]*?<span class="text">([\s\S]*?)<\/span>/
  );
  const { street, city, department } = parseAddress(addressRaw);

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
      category,
      type,
      startDate: isoDate,
      endDate: isoDate
    },
    club: {
      name: clubName,
      street,
      city,
      department,
      phone: organizerPhone || ''
    },
    organizer: {
      name: organizerName,
      email: organizerEmail,
      phone: organizerPhone
    }
  };
}
