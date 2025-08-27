// [XM] Digital Hub — Chat API (Next.js "pages" router)
// File: /pages/api/chat.js
// Host on Vercel. Compatible with the WP widget/snippet we set up.

// -------- Environment Variables ----------
// OPENAI_API_KEY     (required)
// OPENAI_MODEL       (optional, default: gpt-4o-mini)
// MAX_TURNS_FREE     (optional, default: 6)        // free Q&A per session before paywall
// MAX_TOKENS_REPLY   (optional, default: 450)      // cap per reply (cost control)
// HUBSPOT_TOKEN      (optional)                    // HubSpot Private App token (crm write scopes)
// LEAD_WEBHOOK_URL   (optional)                    // Zapier/Make/your endpoint
// ALLOWED_ORIGIN     (optional)                    // e.g. https://xmdigitalhub.com (CORS)

const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;
const OPENAI_MODEL     = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_TURNS_FREE   = Number(process.env.MAX_TURNS_FREE || 6);
const MAX_TOKENS_REPLY = Number(process.env.MAX_TOKENS_REPLY || 450);
const HUBSPOT_TOKEN    = process.env.HUBSPOT_TOKEN || "";
const LEAD_WEBHOOK_URL = process.env.LEAD_WEBHOOK_URL || "";
const ALLOWED_ORIGIN   = process.env.ALLOWED_ORIGIN || "*";

// -------- Brand-safe system prompt ----------
const SYSTEM_PROMPT = `
You are the "[XM] AI Concierge", powered by the "[XM] AI Hub" from [XM] Digital Hub.
- Keep the tokens "[XM] Digital Hub", "[XM] AI Concierge", and "[XM] AI Hub" in English.
- Auto-detect the user's language and reply in that language.
- Be concise, ROI-focused, and practical. Prefer bullets. Name KPIs (CVR, CAC, ROAS, LTV, AOV).
- Scope: CRO & A/B testing, Heatmaps & UX/UI, SEO, Paid Media, Analytics/Attribution, Email/CRM, Content/Social, Marketplaces/Merchandising, Governance/OKRs.
- Email-first; do not push phone calls. If asked for a call, propose email follow-up instead.
`;

// -------- CORS ----------
const ORIGINS = [
  process.env.ALLOWED_ORIGIN || '',
  process.env.ALLOWED_ORIGIN_2 || ''
].filter(Boolean);

function setCORS(req, res) {
  const o = req.headers.origin || '';
  const allow = ORIGINS.length ? (ORIGINS.includes(o) ? o : ORIGINS[0]) : '*';
  res.setHeader("Access-Control-Allow-Origin", allow || '*');
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// -------- API Handler ----------
export default async function handler(req, res) {
  setCORS(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  // Health check
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

    // ---------- Non-billable lead capture ----------
    // (Triggered by widget when user submits website/email/consent or Enterprise form.)
    if (meta?.lead) {
      await Promise.allSettled([pushWebhook(meta.lead, meta), pushHubSpot(meta.lead, meta)]);
      return res.status(200).json({ received: true });
    }

    // ---------- Free-turn paywall ----------
    const nonBillable = !!meta?.nonBillable; // lead capture shouldn't count
    const isPaid = !!meta?.subscriber;       // (future: validate Stripe signature)
    const userTurns = messages.filter(m => m?.role === "user").length;

    if (!nonBillable && !isPaid && userTurns >= MAX_TURNS_FREE) {
      return res.status(200).json({
        paywall: true,
        message:
          meta?.paywallMessage ||
          "You’ve reached the free trial limit. Subscribe to continue."
      });
    }

    // ---------- Call OpenAI ----------
    const payload = {
      model: OPENAI_MODEL,
      temperature: 0.3,
      max_tokens: MAX_TOKENS_REPLY,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages]
    };

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await aiRes.json();

    if (!aiRes.ok) {
      return res.status(500).json({ error: "OpenAI error", detail: data?.error || data });
    }

    const text =
      data?.choices?.[0]?.message?.content?.trim() ||
      "I couldn’t craft a reply right now.";

    // Shape expected by the front-end widget (simple, non-streaming)
    return res.status(200).json({
      data: {
        output_text: text,
        output: [
          { role: "assistant", content: [{ type: "output_text", text }] }
        ]
      },
      usage: data?.usage || null
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}

// -------- Helpers ----------
async function readJSON(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

async function pushWebhook(lead, meta) {
  if (!LEAD_WEBHOOK_URL) return;
  try {
    await fetch(LEAD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor: "[XM] Digital Hub",
        intent: meta?.intent || "",
        enterprise: !!meta?.enterprise,
        lead: sanitizeLead(lead)
      })
    });
  } catch { /* never block chat on webhook errors */ }
}

async function pushHubSpot(lead, meta) {
  if (!HUBSPOT_TOKEN || !lead?.email) return;
  try {
    await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: {
          email: lead.email,
          firstname: lead.name || "",
          website: lead.website || "",
          company: lead.company || "",
          lifecyclestage: "opportunity",
          xm_goal: lead.goal || "",
          xm_budget_range: lead.budget || "",
          xm_company_size: lead.company_size || "",
          xm_page: lead.page || "",
          xm_interest_tier: lead.tier_interest || "",
          xm_consent: String(!!lead.consent),
          xm_consent_ts: lead.ts || new Date().toISOString()
        }
      })
    });
  } catch { /* never block chat on HubSpot errors */ }
}

function sanitizeLead(l = {}) {
  const allow = [
    "name","email","website","company","company_size",
    "budget","goal","consent","tier_interest","page","ts"
  ];
  const out = {};
  for (const k of allow) if (k in l) out[k] = l[k];
  return out;
}
