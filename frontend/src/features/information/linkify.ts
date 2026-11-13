/** A stretch of authored text; `href` is set when it is a link. */
export type TextSegment = { text: string; href?: string };

const web = String.raw`(?:https?:\/\/|www\.)[^\s<>"]+`;
const email = String.raw`[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}`;
// 14.11.2026 and 2026-11-14. Two-digit years are left out: they would also
// match the pairs of a dotted phone number such as 01.23.45.67.89.
const date = String.raw`\d{1,2}[./-]\d{1,2}[./-]\d{4}(?!\d)|\d{4}-\d{2}-\d{2}(?!\d)`;
const time = String.raw`\d{1,2}:\d{2}`;
// Prices, times, years and other numbers that cannot start a phone number.
const number = String.raw`[1-9][\d.,:/-]*`;
// A space, a no-break space or a narrow no-break space, as typed in numbers.
const space = `[ ${String.fromCharCode(0xa0, 0x202f)}]`;
// One space, dot or hyphen between two groups of digits, with parentheses.
const gap = String.raw`(?:\)(?:${space}|[.-])?\(?|(?:${space}|[.-])\(?|\()`;
// A following date or time is not swallowed as more digits of the number.
const phone = String.raw`\(?(?:\+\d|0)\d*(?:${gap}(?!${date}|${time})\d+)*`;

// Alternatives are tried in this order at each position. Dates and numbers
// capture nothing: they only keep the phone rule away from their digits.
const pattern = new RegExp(
  `(${web})|(${email})|${date}|${number}|(${phone})`,
  "gi",
);
const digitThenSpace = new RegExp(String.raw`\d${space}$`);

type Link = { start: number; end: number; href: string };

/** Sentence punctuation after an address, and brackets it does not open. */
function withoutTrailingPunctuation(address: string) {
  let end = address.length;
  while (end > 0) {
    const last = address[end - 1];
    const kept = address.slice(0, end);
    const unopened = (open: string, close: string) =>
      last === close && kept.split(open).length < kept.split(close).length;
    if (
      !".,;:!?'’”»…".includes(last) &&
      !unopened("(", ")") &&
      !unopened("[", "]")
    )
      break;
    end--;
  }
  return address.slice(0, end);
}

function webLink(text: string, start: number, match: string): Link | null {
  // Part of a longer word, address or path: leave it alone.
  if (start > 0 && /[\p{L}\p{N}_@./-]/u.test(text[start - 1])) return null;
  const address = withoutTrailingPunctuation(match);
  const href = /^www\./i.test(address) ? `https://${address}` : address;
  try {
    if (!/^https?:$/.test(new URL(href).protocol)) return null;
  } catch {
    return null;
  }
  return { start, end: start + address.length, href };
}

function phoneLink(text: string, start: number, match: string): Link | null {
  // An opening parenthesis that the number never closes belongs to the text.
  if (match.startsWith("(") && !match.includes(")")) {
    start++;
    match = match.slice(1);
  }
  const end = start + match.length;
  const before = text.slice(Math.max(0, start - 2), start);
  const international = match.includes("+");
  // Part of a reference, an address or a longer series of digits (an IBAN).
  if (
    /[\p{L}\p{N}_@#=&%+/.-]$/u.test(before) ||
    (!international && digitThenSpace.test(before)) ||
    /^[\p{L}_]/u.test(text.slice(end))
  )
    return null;
  // "+33 (0)1 23 45 67 89": the national zero is not dialed after the prefix.
  const digits = (international ? match.replace("(0)", "") : match).replace(
    /\D/g,
    "",
  );
  if (digits.length < 9 || digits.length > 15) return null;
  return { start, end, href: `tel:${international ? "+" : ""}${digits}` };
}

/**
 * Splits authored text into plain stretches and links. Web addresses
 * (`http://`, `https://`, `www.`), e-mail addresses and phone numbers that
 * start with `+` or `0` and have 9 to 15 digits become `https:`, `mailto:` and
 * `tel:` links; nothing else is interpreted, and no other scheme is produced.
 */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let plainFrom = 0;
  pattern.lastIndex = 0;
  for (
    let match = pattern.exec(text);
    match !== null;
    match = pattern.exec(text)
  ) {
    const [, address, mailbox, dialed] = match;
    const link = address
      ? webLink(text, match.index, address)
      : mailbox
        ? {
            start: match.index,
            end: match.index + mailbox.length,
            href: `mailto:${mailbox}`,
          }
        : dialed
          ? phoneLink(text, match.index, dialed)
          : null;
    if (!link) continue;
    if (link.start > plainFrom)
      segments.push({ text: text.slice(plainFrom, link.start) });
    segments.push({
      text: text.slice(link.start, link.end),
      href: link.href,
    });
    plainFrom = link.end;
    // Punctuation trimmed from an address is read again as text.
    pattern.lastIndex = link.end;
  }
  if (plainFrom < text.length) segments.push({ text: text.slice(plainFrom) });
  return segments;
}
