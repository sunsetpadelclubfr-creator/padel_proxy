// api/update-cache.js
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    // Petit test très simple : on écrit un texte dans un blob public
    const now = new Date().toISOString();
    const content = `Test blob - ${now}`;

    const { url } = await put('padel-cache/test.txt', content, {
      access: 'public', // important, comme dans la doc
    });

    return res.status(200).json({
      ok: true,
      message: 'Blob écrit avec succès',
      url,
      content,
    });
  } catch (err) {
    console.error('BLOB TEST ERROR:', err);
    return res.status(500).json({
      ok: false,
      error: err.message,
      stack: err.stack,
    });
  }
}
