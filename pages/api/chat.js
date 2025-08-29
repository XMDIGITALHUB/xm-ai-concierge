// [XM] Digital Hub — AI Concierge API (diagnostic-first + paywall + safety)
// Path: /pages/api/chat.js

const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;
const OPENAI_MODEL     = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_TURNS_FREE   = Number(process.env.MAX_TURNS_FREE || 6);   // free answers
const MAX_TOKENS_REPLY = Number(process.env.MAX_TOKENS_REPLY || 420); // ~mini-audit length
const ALLOWED_ORIGIN   = process.env.ALLOWED_ORIGIN || "*";         // tighten later
const DAILY_HARD_CAP   = Number(process.env.DAILY_HARD_CAP || 0);   // USD cap (0 = off)

// Consultant-grade system prompt
const SYSTEM_PROMPT = `
You are the "[XM] AI Concierge", part of the "[XM] AI Hub" from [XM] Digital Hub.
Audience: senior marketers, growth leads, CMOs, ecommerce heads. They are smart, busy, ROI-focused.

FIRST RESPONSE:
- Ask ONE incisive diagnostic question tailored to the user's first message (about funnel step, audience, traffic source, offer, device mix, or main constraint).
- Do NOT give recommendations until they answer this diagnostic question.

ONGOING STYLE:
- After they answer, switch to value-first: concise, prioritized recommendations with WHY / HOW / KPI. Use frameworks when useful (ICE, AARRR, HEART, LTV:CAC, Payback).
- Reply in the user's language; always keep [XM] tokens in English.
- Progressively collect context within the conversation (not a form): website → goal → company size → budget → email last (for a mini-audit). Each ask must feel natural and optional.
- Prefer email follow-up; do not push phone calls.

Always position yourself as the trusted advisor from [XM] Digital Hub.
`;

export default async function handler(req, res) {
  setCORS(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET")     return res.status(200).json({ ok: true, service: "[XM] AI Concierge" });
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  try {
    const body = await readJSON(req);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const meta = body?.metadata || {};

    // Non-billable lead/webhook pushes: do not count against free answers
    if (meta?.nonBillable) {
      // You can fan-out to CRM/webhook here if you want.
      // await pushWebhook(meta.lead, meta);
      return res.status(200).json({ received: true });
    }

    // Free answers enforcement (count only user turns)
    const userTurns = messages.filter(m => m?.role === "user").length;
    const isPaid = !!meta?.subscriber;
    if (!isPaid && userTurns >= MAX_TURNS_FREE) {
      return res.status(200).json({
        paywall: true,
        message: "You’ve reached the free trial limit. Unlock full audits & experiment roadmaps: Starter $199 / Growth $499."
      });
    }

    // Optional: crude daily spend guard (in-memory)
    if (DAILY_HARD_CAP > 0 && global.__xmSpendUsd && global.__xmSpendUsd >= DAILY_HARD_CAP) {
      return res.status(200).json({
        paywall: true,
        message: "Daily capacity reached. Please try again later or subscribe for guaranteed throughput."
      });
    }

    // Compact history to keep costs predictable
    const compact = trimmedHistory(messages, 4);

    const payload = {
      model: OPENAI_MODEL,
      temperature: 0.35,
      max_tokens: MAX_TOKENS_REPLY,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...compact]
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
      return res.status(500).json({ error: "OpenAI error", detail: data?.error || data });
    }

    // Rough cost estimate (adjust if you change model/pricing)
    try {
      const usage = data?.usage || {};
      const inTok  = usage?.prompt_tokens || 0;
      const outTok = usage?.completion_tokens || 0;
      const estUsd = (inTok + outTok) * 0.000002; // ~ $0.002 / 1K tokens example
      global.__xmSpendUsd = (global.__xmSpendUsd || 0) + estUsd;
    } catch {}

    const text = data?.choices?.[0]?.message?.content?.trim() || "…";

    return res.status(200).json({
      data: {
        output_text: text,
        output: [{ role: "assistant", content: [{ type: "output_text", text }] }]
      },
      usage: data?.usage || null
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}

/* ========== Helpers ========== */
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Keep only the last N user turns + their assistant replies
function trimmedHistory(messages, maxUserTurns = 4) {
  const sys = messages.filter(m => m.role === "system");
  const rest = messages.filter(m => m.role !== "system");
  // walk from the end, collect until we see maxUserTurns user messages
  const kept = [];
  let userCount = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i];
    if (m.role === "user") userCount++;
    kept.unshift(m);
    if (userCount >= maxUserTurns) break;
  }
  return kept;
}

async function readJSON(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { return {}; }
}

// Example webhook (disabled)
// async function pushWebhook(lead, meta) {
//   if (!lead) return;
//   try {
//     await fetch(process.env.LEAD_WEBHOOK_URL, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ vendor: "[XM] Digital Hub", lead, meta })
//     });
//   } catch {}
// }
