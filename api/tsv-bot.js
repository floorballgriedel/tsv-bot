// api/tsv-bot.js
import OpenAI from "openai";

/** Erlaubte Ursprünge (WP-Domains) */
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

/** Dein Vector Store */
const VECTOR_STORE_ID = "vs_68c4739fd58481919479080b69780dfa";

/** Body robust einlesen */
async function readJsonBody(req) {
  try {
    if (req.body) {
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

    // --- API-Key vorhanden? ---
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY fehlt");
      return res.status(500).json({ error: "API key missing on server" });
    }

    // --- Request-Body ---
    const body = await readJsonBody(req);
    const message = (body && body.message) ? String(body.message) : "Hallo!";

    // --- OpenAI-Client ---
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // --- Anfragefunktion mit File Search (Responses API) ---
    async function askOnce() {
      return client.responses.create({
        model: "gpt-4.1-mini",
        // optional: max_output_tokens: 300,
        instructions:
          "Du bist der Vereinsassistent des TSV 1899 Griedel e.V. " +
          "Beantworte Fragen kurz, freundlich und konkret. " +
          "Nutze die Vereinsdokumente per Datei-Suche; wenn du daraus antwortest, füge am Ende 'Quelle: <Dokumentname>' an. " +
          "Wichtige Links: Mitglied werden https://www.tsv-griedel.de/mitglied-werden | " +
          "Spenden https://www.tsv-griedel.de/spenden | " +
          "Probetraining info@tsv-griedel.de | " +
          "Trainingszeiten https://www.tsv-griedel.de/floorball/trainingszeiten. " +
          "Wenn etwas unklar ist, stelle genau EINE Rückfrage.",
        input: message,
        tools: [{ type: "file_search" }],
        attachments: [
          {
            vector_store_id: VECTOR_STORE_ID,
            tools: [{ type: "file_search" }]
          }
        ]
      });
    }

    // --- Call + 429-Retry-Fallback ---
    let resp;
    try {
      resp = await askOnce();
    } catch (e) {
      if (e?.status === 429) {
        try { resp = await askOnce(); }
        catch {
          return res.status(503).json({
            error: "Momentan sind unsere KI-Kontingente erschöpft. Bitte nutze die Links: " +
                   "Mitglied werden: https://www.tsv-griedel.de/mitglied-werden · " +
                   "Spenden: https://www.tsv-griedel.de/spenden · " +
                   "Probetraining: info@tsv-griedel.de"
          });
        }
      } else {
        throw e;
      }
    }

    const text = resp.output_text || "Keine Antwort verfügbar.";
    return res.status(200).json({ reply: text });

  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

