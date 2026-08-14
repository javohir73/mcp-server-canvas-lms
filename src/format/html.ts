import { convert } from 'html-to-text';

const MAX_OUTPUT_LENGTH = 100_000;
const TRUNCATION_NOTE = '[Output truncated at 100,000 characters.]';

export function htmlToReadableText(html: string): string {
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
    ],
  })
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= MAX_OUTPUT_LENGTH) return text;
  return `${text.slice(0, MAX_OUTPUT_LENGTH - TRUNCATION_NOTE.length)}${TRUNCATION_NOTE}`;
}
