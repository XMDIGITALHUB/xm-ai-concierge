// [XM] Digital Hub — AI Concierge API
// Path: /pages/api/chat.js

const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;
const OPENAI_MODEL     = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_TURNS_FREE   = Number(process.env.MAX_TURNS_FREE || 6);
const MAX_TOKENS_REPLY = Number(process.env.MAX_TOKENS_REPLY || 450);

const SYSTEM_PROMPT = `
You are the "[XM] AI Concierge", part of the "[XM] AI Hub" from [XM] Digital Hub.
Audience: senior marketers, growth leads, CMOs, ecommerce heads. They are smart, busy, and ROI-focused.

Style:
- Professional, concise, consultative (like a senior growth strategist).
- Value-first: always deliver actionable, prioritized recommendations with WHY, HOW, and WHAT KPI to track.
- Use frameworks when relevant (ICE, AARRR, HEART, LTV:CAC, Payback).
- Speak in the user's language, but always keep [XM] tokens in English.

Flow:
1. Always provide real insights immediately.
2. Then, progressively ask details to personalize: website → goals → company size → budget → email (last).
   - Example: "To fine-tune benchmarks, could you share your site?"
   - Example: "Company size helps me adjust CAC/LTV ranges."
3. Incorporate any detail given into your next answer (personalize in real time).
4. If free message limit is hit, show paywall:
   "Unlock full audits, experiment roadmaps, and monthly CRO/SEO playbooks: Starter $199 / Growth $499."

Never push phone calls — prefer email follow-up.
Always position yourself as the trusted advisor from [XM] Digital Hub.
`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "[XM] AI Concierge" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  try {
    const body = await readJSON(req);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const meta = body?.metadata || {};

    // Count user turns (billable)
    const userTurns = messages.filter(m => m.role === "user").length;
    const isPaid = !!meta?.subscriber;

    if (!isPaid && userTurns >= MAX_TURNS_FREE) {
      return res.status(200).json({
        paywall: true,
        message: "You’ve reached the free trial limit. Subscribe: Starter $199 / Growth $499."
      });
    }

    const payload = {
      model: OPENAI_MODEL,
      max_tokens: MAX_TOKENS_REPLY,
      temperature: 0.35,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages]
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: "OpenAI error", detail: data?.error });
    }

    const text = data?.choices?.[0]?.message?.content?.trim() || "…";
    return res.status(200).json({
      data: {
        output_text: text,
        output: [{ role: "assistant", content: [{ type: "output_text", text }] }]
      },
      usage: data?.usage || null
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
}

async function readJSON(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
