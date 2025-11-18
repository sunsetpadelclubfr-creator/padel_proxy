// api/cron.js
export default async function handler(req, res) {
  try {
    const url = `https://${req.headers.host}/api/update-cache`;
    const upstream = await fetch(url);
    const data = await upstream.json();

    return res.status(200).json({
      ok: true,
      triggered: true,
      data,
    });
  } catch (err) {
    console.error("Cron ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
