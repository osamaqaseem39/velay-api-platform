import type { FreeTextBookingParseResult } from './parse-free-text-booking.util';
import {
  type BookingLlmRawExtract,
  parseBookingLlmExtract,
} from './gemini-free-text-parse.util';

function stripJsonFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  return m ? m[1].trim() : t;
}

export function isOpenAiBookingParseConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function openAiBookingModelId(): string {
  const raw = process.env.OPENAI_BOOKING_MODEL?.trim();
  return raw && raw.length <= 128 ? raw : 'gpt-4o-mini';
}

/**
 * Calls OpenAI when `OPENAI_API_KEY` is set. Returns null on failure.
 */
export async function fetchOpenAiBookingExtract(
  message: string,
  referenceDateYmd: string,
): Promise<(Partial<FreeTextBookingParseResult> & { formattedSummary?: string | null }) | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = openAiBookingModelId();

  const instruction = `You extract sports-facility booking details from messy text (WhatsApp, SMS). Venue context: Pakistan (PKR, 03XX mobiles).

REFERENCE_DATE (YYYY-MM-DD — use to resolve dates that omit the year): ${referenceDateYmd}

Return ONLY valid JSON with exactly these keys:
{
  "customerName": string | null,
  "phoneDigits": string | null,
  "bookingDate": string | null,
  "startTime": string | null,
  "endTime": string | null,
  "amount": number | null,
  "courtPhrase": string | null,
  "courtNumber": number | null,
  "inferredSport": "padel" | "futsal" | "cricket" | "table-tennis" | null,
  "formattedSummary": string
}

Rules:
- phoneDigits: 10 digits starting with 3 (strip country code 92 and leading 0 from 03XXXXXXXXX). null if absent or if the number is not exactly 11 digits locally (03 + nine more).
- bookingDate: YYYY-MM-DD only. Prefer explicit dates in the message. Map "today", "tonight" to REFERENCE_DATE; "tomorrow" to the next calendar day.
- startTime / endTime: 24h HH:mm. endTime may be "24:00" for end of calendar day. null if unclear. For "9-12 tonight" with no am/pm, treat as 21:00–24:00 when clearly evening.
- amount: PKR as a number, null if not stated.
- courtPhrase: natural phrase, e.g. "Padel Court 1", "Futsal Court 2", "Cricket Turf A".
- courtNumber: integer court index if clear, else null.
- inferredSport: best guess from wording — padel, futsal, cricket (turf/nets), or table-tennis; prefer futsal vs cricket when the message distinguishes them. null if unknown.
- formattedSummary: 2–4 short sentences for staff (who, when, where, amount).

USER_MESSAGE:
${message.trim()}`;

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You output only compact JSON objects for booking extraction. No prose outside JSON.',
      },
      { role: 'user', content: instruction },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.15,
    max_tokens: 1024,
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45_000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('Empty OpenAI response');

    const json = JSON.parse(stripJsonFence(text)) as BookingLlmRawExtract;
    return parseBookingLlmExtract(json);
  } finally {
    clearTimeout(timer);
  }
}
