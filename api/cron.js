// api/cron.js

export default async function handler(req, res) {
  try {
    const baseUrl =
      process.env.PADEL_PROXY_URL || "https://padel-proxy.vercel.app";

    const resp = await fetch(`${baseUrl}/api/padel-proxy?refresh=1`);
    const data = await resp.json();

    return res.status(200).json({
      ok: true,
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (e) {
    console.error("cron error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
