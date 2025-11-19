// api/cron.js

export default async function handler(req, res) {
  try {
    const url = `${process.env.VERCEL_URL?.startsWith("http") ? "" : "https://"}${
      process.env.VERCEL_URL
    }/api/update-cache`;

    await fetch(url);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("cron ERROR", err);
    return res.status(500).json({ error: "cron failed", details: err.message });
  }
}
