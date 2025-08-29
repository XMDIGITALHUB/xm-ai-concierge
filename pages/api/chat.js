// /pages/api/chat.js
// [XM] Digital Hub — AI Concierge API (diagnostic-first flow + paywall-ready + clear errors)

export const config = {
  runtime: "edge",
};

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": process.env.ALLOWED_ORIGIN || "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      ...headers,
    },
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return json(200, { ok: true });

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed. Use POST." });
  }

  // ---- Env & config ----
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const MAX_TOKENS_PER_REPLY = Number(process.env.MAX_TOKENS_PER_REPLY || 420);
  const MAX_TURNS_FREE = Number(process.env.MAX_TURNS_FREE || 6);
  const DAILY_HARD_CAP = Number(process.env.DAILY_HARD_CAP || 0); // USD/day; 0 = off

  if (!OPENAI_API_KEY) {
    return json(500, {
      error: "Missing OPENAI_API_KEY.",
      hint: "Vercel → Project → Settings → Environment Variables → OPENAI_API_KEY",
    });
  }

  // ---- Input ----
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const { messages, freeTurnsUsed = 0 } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: "messages must be a non-empty array." });
  }

  // ---- Simple free-paywall guard (server-side) ----
  if (MAX_TURNS_FREE > 0 && Number(freeTurnsUsed) >= MAX_TURNS_FREE) {
    return json(402, {
      error: "free_limit_reached",
      message:
        "You’ve reached the free trial limit. Please subscribe to continue.",
    });
  }

  // ---- Daily cost guard (optional; requires your own metering) ----
  if (DAILY_HARD_CAP > 0) {
    // hook your own store/kv here to check daily spend and bail if exceeded
    // return json(429, { error: "daily_cap_reached" });
  }

  // ---- System prompt (brand rules + first-turn behavior) ----
  const SYSTEM_PROMPT = `
You are the “[XM] AI Concierge”, part of the “[XM] AI Hub” from [XM] Digital Hub.
Audience: senior marketers, product leads, ecommerce heads. Be concise, ROI-focused.

FIRST TURN:
- Start with ONE incisive diagnostic question based on the user’s first message (funnel step, audience, traffic source, device split, KPI).
- Do NOT give recommendations until they answer this question.

ONGOING STYLE:
- After they answer, switch to value-first: prioritized recommendations with WHY / HOW / KPI.
- Use frameworks when helpful (e.g., ICE score, A/B test hypothesis format, North Star metric).
- Prefer bullets and numbered steps (3–7).
- Keep brand tokens “[XM] Digital Hub”, “[XM] AI Concierge”, “[XM] AI Hub” in English.
- If user asks for an email follow-up, collect work email (business domains only) and keep the chat going.

CAPABILITIES (high level):
- CRO & A/B testing, UX/UI, Heatmaps & Session Replay, Analytics & Attribution, SEO/SEM, Email/CRM, Content/Social, Merchandising & Pricing.

GUARDRAILS:
- Don’t request email upfront. Ask for website only if needed to tailor the answer.
- If user hits the free limit, politely tell them about Starter $199/mo or Growth $499/mo and stop the answer.
`;

  // ---- Build the OpenAI request ----
  const openaiPayload = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ],
    temperature: 0.3,
    max_tokens: MAX_TOKENS_PER_REPLY,
  };

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(openaiPayload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      // Normalize common errors so the widget can show helpful text
      const code = data?.error?.code || data?.error?.type || "openai_error";
      const msg =
        data?.error?.message ||
        "OpenAI request failed. Check API key, model, or usage limits.";
      return json(502, { error: code, message: msg });
    }

    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!text) return json(500, { error: "empty_response" });

    return json(200, {
      ok: true,
      model: OPENAI_MODEL,
      reply: text,
    });
  } catch (err) {
    return json(500, {
      error: "server_error",
      message: err?.message || "Unexpected error",
    });
  }
}
