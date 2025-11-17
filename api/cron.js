// api/cron.js

export default async function handler(req, res) {
  try {
    const targetUrl = `https://${req.headers.host}/api/padel-proxy?refresh=1`;

    console.log("Refreshing cache via cron:", targetUrl);

    const upstream = await fetch(targetUrl);

    const data = await upstream.json();

    return res.status(200).json({
      ok: true,
      updated: new Date().toISOString(),
      items: data.length || 0,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
