// api/tsv-bot.js
import OpenAI from "openai";

/** erlaubte Webseiten, von denen dein WP-Widget die API aufrufen darf */
const ALLOWED_ORIGINS = new Set([
  "https://www.tsv-griedel.de",
  "https://tsv-griedel.de",
  "http://www.tsv-griedel.de",
  "http://tsv-griedel.de",
  "https://www.floorballgriedel.de",
  "https://floorballgriedel.de",
  "http://www.floorballgriedel.de",
  "http://floorballgriedel.de",
  "http://localhost:3000"
]);

/** Hilfsfunktion: JSON-Body sicher einlesen (Node Serverless Functions parsen nicht immer automatisch) */
async function readJsonBody(req) {
  try {
    if (req.body) {
      // Kann bereits geparst sein (bei manchen Setups), sonst String/Buffer:
      if (typeof req.body === "object") return req.body;
      if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Body parse error:", e);
    return {};
  }
}

export default async function handler(req, res) {
  try {
    // --- CORS ---
    const origin = req.headers.origin || "";
if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
res.setHeader("Vary", "Origin");
res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");


    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

    // --- Sicherheit: API-Key vorhanden? ---
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY fehlt");
      return res.status(500).json({ error: "API key missing on server" });
    }

    // --- Request-Body lesen ---
    const body = await readJsonBody(req);
    const message = (body && body.message) ? String(body.message) : "Hallo!";

    // --- OpenAI anfragen ---
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "Du bist der Vereinsassistent des TSV 1899 Griedel e.V. " +
        "Antworte kurz, freundlich und konkret. Nutze diese Infos, wenn passend: " +
        "Mitglied werden: https://www.tsv-griedel.de/mitglied-werden | " +
        "Spenden: https://www.tsv-griedel.de/spenden | " +
        "Probetraining: info@tsv-griedel.de | " +
        "Trainingszeiten: https://www.tsv-griedel.de/floorball/trainingszeiten. " +
        "Wenn etwas unklar ist, stelle genau eine Rückfrage.",
      input: message
      // (später optional) tools: [{ type: "file_search" }],
    });

    const text = response.output_text || "Keine Antwort verfügbar.";
    return res.status(200).json({ reply: text });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Serverfehler" });
  }
}
