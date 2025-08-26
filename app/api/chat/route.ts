import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_TURNS_FREE = Number(process.env.MAX_TURNS_FREE || 6);
const MAX_TOKENS_PER_REPLY = Number(process.env.MAX_TOKENS_PER_REPLY || 450);

const SYSTEM_PROMPT = `
You are the "[XM] AI Concierge", powered by the "[XM] AI Hub".
...
`;

type Msg = { role: "system"|"user"|"assistant"; content: string };

async function chat(messages: Msg[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.3,
      max_tokens: MAX_TOKENS_PER_REPLY
    })
  });
  const data = await res.json();
  return { text: data?.choices?.[0]?.message?.content?.trim() || "" };
}

export async function POST(req: NextRequest) {
  const { messages = [] } = await req.json();
  const userTurns = (messages as Msg[]).filter(m => m.role === "user").length;
  if (userTurns >= MAX_TURNS_FREE) {
    return NextResponse.json({ paywall: true, message: "Trial limit reached. Subscribe to continue." });
  }
  const { text } = await chat(messages as Msg[]);
  return NextResponse.json({
    data: { output_text: text }
  });
}
