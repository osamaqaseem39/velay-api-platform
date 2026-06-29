/**
 * Heuristic extraction of booking fields from unstructured text (WhatsApp, SMS, notes).
 * Tuned for Pakistan sports venues: PK phones, Rs/PKR amounts, English month/day, 12h times;
 * padel, futsal, cricket (turf), and table tennis cues.
 */

const MONTH_WORD: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdFromParts(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseMonthToken(t: string): number | null {
  const k = t.toLowerCase().replace(/\./g, '');
  return MONTH_WORD[k] ?? null;
}

function minutesToHHmm(total: number): string {
  if (total === 24 * 60) return '24:00';
  if (total > 24 * 60 || total < 0) {
    const norm = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(norm / 60);
    const m = norm % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** 12-hour clock: hour 1–12, minutes 0–59, AM/PM. */
function parse12hToMinutes(
  hour: number,
  minute: number,
  ap: string,
): number | null {
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  const up = ap.toUpperCase();
  let h = hour % 12;
  if (up.startsWith('P')) h += 12;
  return h * 60 + minute;
}

/** 24-hour clock 0–23, minutes 0–59. */
function parse24hToMinutes(hour: number, minute: number): number | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Parse one side: `13:00`, `1:30pm`, `1pm`, `11:00 pm`, `0:30` (24h). */
function parseSingleClockToken(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$/i);
  if (m12) {
    return parse12hToMinutes(Number(m12[1]), Number(m12[2] ?? 0), m12[3]);
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    return parse24hToMinutes(Number(m24[1]), Number(m24[2]));
  }
  const m24h = s.match(/^(\d{1,2})h(\d{2})$/i);
  if (m24h) {
    return parse24hToMinutes(Number(m24h[1]), Number(m24h[2]));
  }
  return null;
}

/** Hour only with meridian, e.g. `11` + `pm` → 23:00. */
function parse12hHourOnly(hour: number, ap: string): number | null {
  return parse12hToMinutes(hour, 0, ap);
}

const RANGE_SEP = String.raw`(?:\s*[-–—]\s*|\s+(?:to|until|till)\s+)`;

function extractTimeRange(text: string): { start: string; end: string } | null {
  const t = text.replace(/\u2013|\u2014/g, '-');

  /** `at 9-12 tonight`, `9-12 tonight` — hour-only, implied PM, end 12 = midnight */
  {
    const night = /\b(tonight|this\s+evening|tonite)\b/i.test(t);
    if (night) {
      const m = t.match(/\b(?:at\s+)?(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i);
      if (m) {
        const h1 = Number(m[1]);
        const h2 = Number(m[2]);
        if (h1 >= 1 && h1 <= 11 && h2 === 12) {
          const a = parse12hHourOnly(h1, 'pm');
          if (a != null) return { start: minutesToHHmm(a), end: '24:00' };
        }
        if (h1 >= 6 && h1 <= 11 && h2 >= 6 && h2 <= 11 && h2 > h1) {
          const a = parse12hHourOnly(h1, 'pm');
          const b = parse12hHourOnly(h2, 'pm');
          if (a != null && b != null && b > a) {
            return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
          }
        }
      }
    }
  }

  /** `between 2pm and 4pm` */
  {
    const m = t.match(
      /\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+and\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
    );
    if (m) {
      const a = parse12hToMinutes(Number(m[1]), Number(m[2] ?? 0), m[3]);
      const b = parse12hToMinutes(Number(m[4]), Number(m[5] ?? 0), m[6]);
      if (a != null && b != null) {
        if (b > a) return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
        return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** Two meridiems with optional minutes: `11:00 PM to 1:00 AM`, `11pm-1am`, `11 pm to 1 am` */
  {
    const m = t.match(
      /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:[-–]|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
    );
    if (m) {
      const a = parse12hToMinutes(Number(m[1]), Number(m[2] ?? 0), m[3]);
      const b = parse12hToMinutes(Number(m[4]), Number(m[5] ?? 0), m[6]);
      if (a != null && b != null) {
        if (b > a) return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
        return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** `5:00-6:00 PM` — one meridian for both clock times */
  {
    const m = t.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
    if (m) {
      const ap = m[5];
      const a = parse12hToMinutes(Number(m[1]), Number(m[2]), ap);
      const b = parse12hToMinutes(Number(m[3]), Number(m[4]), ap);
      if (a != null && b != null && b > a) {
        return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** `1:30 PM - 2:45 PM` (spaces around dash) */
  {
    const m = t.match(
      new RegExp(
        `(\\d{1,2}):(\\d{2})\\s*(am|pm)\\s*${RANGE_SEP}\\s*(\\d{1,2}):(\\d{2})\\s*(am|pm)`,
        'i',
      ),
    );
    if (m) {
      const a = parse12hToMinutes(Number(m[1]), Number(m[2]), m[3]);
      const b = parse12hToMinutes(Number(m[4]), Number(m[5]), m[6]);
      if (a != null && b != null && b > a) {
        return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** `1 PM - 2 PM` hour + meridian each side */
  {
    const m = t.match(
      new RegExp(
        `(\\d{1,2})\\s*(am|pm)\\s*${RANGE_SEP}\\s*(\\d{1,2})\\s*(am|pm)`,
        'i',
      ),
    );
    if (m) {
      const a = parse12hHourOnly(Number(m[1]), m[2]);
      const b = parse12hHourOnly(Number(m[3]), m[4]);
      if (a != null && b != null) {
        if (b > a) return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
        return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** `1-2pm`, `10-12 pm`, `1 – 2 pm` — hour-only, trailing meridian; `10-12 pm` → 22:00–24:00 */
  {
    const m = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(am|pm)\b/i);
    if (m) {
      const h1 = Number(m[1]);
      const h2 = Number(m[2]);
      const ap = m[3];
      const a = parse12hHourOnly(h1, ap);
      if (a != null) {
        if (ap.toLowerCase() === 'pm' && h2 === 12 && h1 >= 1 && h1 < 12) {
          return { start: minutesToHHmm(a), end: '24:00' };
        }
        const b = parse12hHourOnly(h2, ap);
        if (b != null && b > a) return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** `1pm-2:30pm` first side hour-only */
  {
    const m = t.match(/(\d{1,2})\s*(am|pm)\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (m) {
      const a = parse12hHourOnly(Number(m[1]), m[2]);
      const b = parse12hToMinutes(Number(m[3]), Number(m[4]), m[5]);
      if (a != null && b != null) {
        if (b > a) return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
        return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** 24h `13:00-14:30`, `09:00–10:15` (no am/pm on the segment) */
  {
    const m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*[-–]\s*([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]m)/i);
    if (m) {
      const a = parse24hToMinutes(Number(m[1]), Number(m[2]));
      const b = parse24hToMinutes(Number(m[3]), Number(m[4]));
      if (a != null && b != null) {
        if (b > a) return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
        return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** 24h with `to`: `23:00 to 01:00` */
  {
    const m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s+to\s+([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]m)/i);
    if (m) {
      const a = parse24hToMinutes(Number(m[1]), Number(m[2]));
      const b = parse24hToMinutes(Number(m[3]), Number(m[4]));
      if (a != null && b != null) {
        if (b > a) return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
        return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** `13h30-14h45` */
  {
    const m = t.match(/\b([01]?\d|2[0-3])h([0-5]\d)\s*[-–]\s*([01]?\d|2[0-3])h([0-5]\d)\b/i);
    if (m) {
      const a = parse24hToMinutes(Number(m[1]), Number(m[2]));
      const b = parse24hToMinutes(Number(m[3]), Number(m[4]));
      if (a != null && b != null) {
        if (b > a) return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
        return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
      }
    }
  }

  /** Legacy combined patterns */
  const patterns: RegExp[] = [
    new RegExp(
      `(\\d{1,2}):(\\d{2})\\s*(AM|PM)${RANGE_SEP}(\\d{1,2}):(\\d{2})\\s*(AM|PM)`,
      'i',
    ),
    new RegExp(
      `(\\d{1,2})\\s*(AM|PM)${RANGE_SEP}(\\d{1,2}):(\\d{2})\\s*(AM|PM)`,
      'i',
    ),
    new RegExp(`(\\d{1,2})\\s*(AM|PM)${RANGE_SEP}(\\d{1,2})\\s*(AM|PM)`, 'i'),
    new RegExp(`(\\d{2}):(\\d{2})${RANGE_SEP}(\\d{2}):(\\d{2})`),
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    if (re.source.includes('AM')) {
      if (m.length >= 7) {
        const a = parse12hToMinutes(Number(m[1]), Number(m[2]), m[3]);
        const b = parse12hToMinutes(Number(m[4]), Number(m[5]), m[6]);
        if (a != null && b != null && b > a) {
          return {
            start: minutesToHHmm(a),
            end: minutesToHHmm(b),
          };
        }
      }
      if (m.length >= 6 && !m[2].match(/\d/)) {
        const a = parse12hToMinutes(Number(m[1]), 0, m[2]);
        const b = parse12hToMinutes(Number(m[3]), Number(m[4]), m[5]);
        if (a != null && b != null && b > a) {
          return {
            start: minutesToHHmm(a),
            end: minutesToHHmm(b),
          };
        }
      }
    } else {
      const h1 = Number(m[1]);
      const min1 = Number(m[2]);
      const h2 = Number(m[3]);
      const min2 = Number(m[4]);
      if (
        h1 >= 0 &&
        h1 <= 23 &&
        h2 >= 0 &&
        h2 <= 23 &&
        min1 >= 0 &&
        min1 <= 59 &&
        min2 >= 0 &&
        min2 <= 59
      ) {
        const a = h1 * 60 + min1;
        const b = h2 * 60 + min2;
        if (b > a) {
          return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
        }
        if (b < a) {
          return { start: minutesToHHmm(a), end: minutesToHHmm(b) };
        }
      }
    }
  }
  return null;
}

export type FreeTextBookingParseResult = {
  customerName: string | null;
  /** Local mobile digits (e.g. 3343544353 without country code). */
  phoneDigits: string | null;
  bookingDate: string | null;
  startTime: string | null;
  endTime: string | null;
  amount: number | null;
  /** Raw court phrase from text, e.g. "Padel Court 1". */
  courtPhrase: string | null;
  courtNumber: number | null;
  inferredSport: 'padel' | 'futsal' | 'cricket' | 'table-tennis' | null;
  warnings: string[];
  /** When Gemini ran successfully: short staff-readable summary. */
  formattedSummary?: string | null;
  /** How the structured fields were produced. */
  parseSource?: 'heuristic' | 'merged';
};

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function extractPhone(text: string): string | null {
  const intl = text.match(/\b(?:\+|00)92\s*0?3\d{9}\b/);
  if (intl) {
    let d = intl[0].replace(/\D/g, '');
    if (d.startsWith('92')) d = d.slice(2);
    if (d.startsWith('0')) d = d.slice(1);
    if (/^3\d{9}$/.test(d)) return d;
  }
  const local = text.match(/\b03\d{9}\b/);
  if (local) return local[0].slice(1);
  const mSpaced = text.match(/\b03\d{2}[\s-]?\d{7}\b/);
  if (mSpaced) {
    const d = mSpaced[0].replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('03')) return d.slice(1);
  }
  return null;
}

function extractAmount(text: string): number | null {
  const reList = [
    /(?:PKR|Rs\.?|RS\.?)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /(?:paid|payment|fee|amount|charges?|total)\s*:?\s*(?:PKR|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /\b([\d,]+(?:\.\d{1,2})?)\s*PKR\b/gi,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:PKR|Rs\.?)\b/gi,
  ];
  const candidates: number[] = [];
  for (const re of reList) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = Number(String(m[1]).replace(/,/g, ''));
      if (Number.isFinite(n) && n >= 50 && n <= 500000) candidates.push(n);
    }
  }
  if (!candidates.length) return null;
  return Math.max(...candidates);
}

function extractDate(text: string, refYmd: string): string | null {
  const refY = Number(refYmd.slice(0, 4));
  const refM = Number(refYmd.slice(5, 7));
  const refD = Number(refYmd.slice(8, 10));

  const yFromText = (() => {
    const m = text.match(/\b(20\d{2})\b/);
    return m ? Number(m[1]) : null;
  })();

  const tryYear = (y: number, m: number, d: number): string | null =>
    ymdFromParts(y, m, d);

  const monthDay = (m: number, d: number): string | null => {
    const year = yFromText ?? refY;
    let y = year;
    let cand = tryYear(y, m, d);
    if (!cand) return null;
    if (yFromText == null) {
      const cTime = new Date(`${cand}T12:00:00Z`).getTime();
      const rTime = new Date(`${refYmd}T12:00:00Z`).getTime();
      if (cTime < rTime - 120 * 24 * 3600 * 1000) {
        y += 1;
        cand = tryYear(y, m, d);
      }
    }
    return cand;
  };

  const rxDayMonth = new RegExp(
    `\\b(\\d{1,2})\\s+(${Object.keys(MONTH_WORD).join('|')})\\b`,
    'i',
  );
  const dm = text.match(rxDayMonth);
  if (dm) {
    const d = Number(dm[1]);
    const m = parseMonthToken(dm[2]);
    if (m) return monthDay(m, d);
  }

  const rxMonthDay = new RegExp(
    `\\b(${Object.keys(MONTH_WORD).join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    'i',
  );
  const md = text.match(rxMonthDay);
  if (md) {
    const m = parseMonthToken(md[1]);
    const d = Number(md[2]);
    if (m) return monthDay(m, d);
  }

  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return tryYear(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  if (/\b(tonight|today)\b/i.test(text)) {
    return refYmd;
  }
  if (/\btomorrow\b/i.test(text)) {
    const dt = new Date(`${refYmd}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const da = dt.getUTCDate();
    return tryYear(y, mo, da);
  }

  const dmy = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    return tryYear(y, Number(dmy[2]), Number(dmy[1]));
  }

  const dayMonthYear = text.match(
    new RegExp(
      `\\b(\\d{1,2})\\s+(${Object.keys(MONTH_WORD).join('|')})\\s+(20\\d{2})\\b`,
      'i',
    ),
  );
  if (dayMonthYear) {
    const d = Number(dayMonthYear[1]);
    const m = parseMonthToken(dayMonthYear[2]);
    const y = Number(dayMonthYear[3]);
    if (m) return tryYear(y, m, d);
  }

  void refM;
  void refD;
  return null;
}

function extractCourtPhrase(text: string): { phrase: string | null; num: number | null } {
  const m1 = text.match(/\b(?:padel\s+)?court\s*(\d+)\b/i);
  if (m1) {
    return {
      phrase: normalizeSpaces(m1[0].replace(/\s+/g, ' ')),
      num: Number(m1[1]),
    };
  }
  const m2 = text.match(/\b(?:padel|futsal|cricket|turf)\s+court\s*(\d+)\b/i);
  if (m2) {
    return { phrase: normalizeSpaces(m2[0]), num: Number(m2[1]) };
  }
  return { phrase: null, num: null };
}

const STOP_NAME = new Set(
  [
    'padel',
    'court',
    'booking',
    'reserved',
    'confirmed',
    'customer',
    'contact',
    'phone',
    'amount',
    'paid',
    'may',
    'june',
    'session',
    'slot',
    'active',
    'sports',
    'facility',
    'memo',
    'invoice',
    'receipt',
    'log',
    'entry',
    'note',
    'token',
    'done',
    'enjoy',
    'pkr',
    'futsal',
    'cricket',
    'turf',
  ].map((s) => s.toLowerCase()),
);

function scoreNameCandidate(s: string): number {
  const w = s.split(/\s+/).filter(Boolean);
  if (w.length < 2 || w.length > 5) return -1;
  let score = w.length * 3;
  for (const x of w) {
    if (/^\d+$/.test(x)) return -1;
    if (STOP_NAME.has(x.toLowerCase())) score -= 5;
    if (/^[A-Z][a-z]+$/.test(x)) score += 1;
    if (/^[A-Z]{2,}$/.test(x)) score += 1;
  }
  return score;
}

function toTitleCaseWords(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function looksLikeMultilineNameLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 4 || t.length > 64) return false;
  if (/^0?3\d{9}$/.test(t.replace(/\D/g, ''))) return false;
  if (/\d{1,2}\s+[A-Za-z]{3,12}\s+20\d{2}/.test(t)) return false;
  if (/\d{1,2}\s*:\s*\d{2}/.test(t)) return false;
  if (/\bPKR\b|\bRS\.?\b|\bPADEL\b|\bCOURT\b|\bCRICKET\b|\bFUTSAL\b|\bTURF\b/i.test(t))
    return false;
  if (/^(BOOKING|DONE|ENJOY|CONFIRMED|RESERVED|THANK|THANKS)\b/i.test(t)) return false;
  if (/^\d[\d,\s]*$/.test(t)) return false;
  if (!/^[A-Za-z][A-Za-z\s'.-]{2,62}[A-Za-z]$/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5;
}

function extractCustomerName(text: string, phone: string | null): string | null {
  let t = text.replace(/\u2013|\u2014/g, '-');
  if (phone) {
    t = t.replace(new RegExp(phone.replace(/(\d)/g, '[\\s-]?$1'), 'g'), ' ');
  }

  const candidates: string[] = [];

  const rawLines = (text ?? '').split(/\r?\n|\r|\u2028/).map((l) => l.trim());
  for (const line of rawLines.slice(0, 12)) {
    if (line && looksLikeMultilineNameLine(line)) {
      candidates.push(toTitleCaseWords(line));
      break;
    }
  }

  /** One physical line or collapsed paste: `HASEEB KHAN 5:00-6:00 PM …` (name line fails clock check) */
  const collapsed = normalizeSpaces(t.replace(/\r?\n|\r|\u2028/g, ' '));
  const inlineName = collapsed.match(
    /^([A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*){1,4})\s+(?=\d{1,2}\s*:\s*\d{2}\s*[-–]\s*\d{1,2}\s*:\s*\d{2}\s*(?:am|pm)\b)/i,
  );
  if (inlineName?.[1]) {
    candidates.push(toTitleCaseWords(inlineName[1]));
  }

  const pipe = t.match(
    /^\s*([^|/]{3,80}?)\s*[|/]\s*(?:\+?92|0)?3\d/i,
  );
  if (pipe?.[1]) candidates.push(pipe[1].trim());

  const bookingFor = t.match(
    /\b(?:for|under|by|to)\s+([A-Za-z][^|/\n]{2,60}?)(?:\s+(?:booked|has|on|at|from|between|,|\|))/i,
  );
  if (bookingFor?.[1]) {
    const bf = bookingFor[1].trim();
    if (!/^(padel|futsal|cricket|turf|court|table\s+tennis)$/i.test(bf)) {
      candidates.push(bf);
    }
  }

  const leadNameBooking = collapsed.match(
    /^([a-zA-Z][a-zA-Z'.-]*(?:\s+[a-zA-Z][a-zA-Z'.-]*){1,4})\s+booking\b/i,
  );
  if (leadNameBooking?.[1]) candidates.push(toTitleCaseWords(leadNameBooking[1]));

  const bookedLead = t.match(
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4})\s+(?:booked|reserved|secured|confirmed|officially)/im,
  );
  if (bookedLead?.[1]) candidates.push(bookedLead[1].trim());

  const nameColon = t.match(/\bName\s*:\s*([^|/\n]+)/i);
  if (nameColon?.[1]) candidates.push(nameColon[1].trim());

  const customer = t.match(/\bCustomer\s+([A-Z][^|(/\n]{2,60})/i);
  if (customer?.[1]) candidates.push(customer[1].trim());

  let best: string | null = null;
  let bestScore = 0;
  for (const raw of candidates) {
    const cleaned = normalizeSpaces(
      raw.replace(/^(?:the|a|an)\s+/i, '').replace(/[,]+$/g, ''),
    );
    const sc = scoreNameCandidate(cleaned);
    if (sc > bestScore) {
      bestScore = sc;
      best = cleaned;
    }
  }
  return best;
}

function inferSport(text: string, courtPhrase: string | null): FreeTextBookingParseResult['inferredSport'] {
  const low = text.toLowerCase();
  const phraseL = (courtPhrase ?? '').toLowerCase();
  if (phraseL.includes('padel') || /\bpadel\b/i.test(text)) return 'padel';
  if (phraseL.includes('futsal') || /\bfutsal\b/i.test(low)) return 'futsal';
  if (phraseL.includes('cricket') || /\bcricket\b/i.test(low)) return 'cricket';
  if (phraseL.includes('turf') || /\bturf\b/i.test(low)) {
    if (/\bcricket\b/i.test(low) && !/\bfutsal\b/i.test(low)) return 'cricket';
    if (/\bfutsal\b/i.test(low) && !/\bcricket\b/i.test(low)) return 'futsal';
    return 'futsal';
  }
  if (/\btable[\s-]?tennis\b/i.test(low)) return 'table-tennis';
  if (/\bcourt\s*\d+/i.test(text) && /\bpadel\b/i.test(low)) return 'padel';
  if (/\bcourt\s*\d+/i.test(text) && /\b(?:futsal|turf)\b/i.test(low)) return 'futsal';
  if (/\bcourt\s*\d+/i.test(text) && /\bcricket\b/i.test(low)) return 'cricket';
  return null;
}

export function buildParseGapWarnings(
  p: Pick<
    FreeTextBookingParseResult,
    | 'phoneDigits'
    | 'bookingDate'
    | 'startTime'
    | 'endTime'
    | 'courtPhrase'
    | 'inferredSport'
  >,
  messageFlat: string,
): string[] {
  const w: string[] = [];
  const hint = messageFlat.trim();
  if (!p.phoneDigits) {
    if (/\b03\d{8}\b/.test(hint) && !/\b03\d{9}\b/.test(hint)) {
      w.push(
        'Mobile looks like 03… but has 10 digits instead of 11 (03XXXXXXXXX); confirm the full number.',
      );
    } else {
      w.push('Could not find a Pakistan mobile number (03XX…).');
    }
  }
  if (!p.bookingDate) w.push('Could not parse booking date.');
  if (!p.startTime || !p.endTime) w.push('Could not parse start and end time.');
  if (!p.courtPhrase) w.push('Could not identify court (e.g. Padel Court 1).');
  if (!p.inferredSport) w.push('Could not infer sport type from text.');
  return w;
}

/**
 * @param message Raw message
 * @param referenceDateYmd Calendar day used when the message omits a year (`YYYY-MM-DD`)
 */
export function parseFreeTextBookingMessage(
  message: string,
  referenceDateYmd: string,
): FreeTextBookingParseResult {
  const text = (message ?? '').trim();
  if (!text) {
    return {
      customerName: null,
      phoneDigits: null,
      bookingDate: null,
      startTime: null,
      endTime: null,
      amount: null,
      courtPhrase: null,
      courtNumber: null,
      inferredSport: null,
      warnings: ['Empty message'],
    };
  }

  const refYmd =
    /^\d{4}-\d{2}-\d{2}$/.test(referenceDateYmd) === true
      ? referenceDateYmd
      : new Date().toISOString().slice(0, 10);

  /** Flatten newlines so patterns can match across line breaks */
  const flat = normalizeSpaces(text.replace(/\r?\n/g, ' '));

  const phoneDigits = extractPhone(text) ?? extractPhone(flat);

  const amount = extractAmount(flat) ?? extractAmount(text);

  const bookingDate = extractDate(flat, refYmd) ?? extractDate(text, refYmd);

  const tr = extractTimeRange(flat) ?? extractTimeRange(text);
  const startTime = tr?.start ?? null;
  const endTime = tr?.end ?? null;

  const { phrase: courtPhrase, num: courtNumber } = extractCourtPhrase(flat);

  const inferredSport = inferSport(flat, courtPhrase);

  const customerName = extractCustomerName(text, phoneDigits);

  const warnings = buildParseGapWarnings(
    {
      phoneDigits,
      bookingDate,
      startTime,
      endTime,
      courtPhrase,
      inferredSport,
    },
    flat,
  );

  return {
    customerName,
    phoneDigits,
    bookingDate,
    startTime,
    endTime,
    amount,
    courtPhrase,
    courtNumber,
    inferredSport,
    warnings,
  };
}
