import { describe, expect, it } from 'vitest';
import { htmlToReadableText } from '../src/format/html.js';
import { formatTimestamp, textResult } from '../src/format/text.js';

describe('htmlToReadableText', () => {
  it('retains anchor destinations in readable text', () => {
    expect(
      htmlToReadableText(
        '<p>Read <a href="https://example.edu/week1">Week 1</a>.</p>',
      ),
    ).toBe('Read Week 1 [https://example.edu/week1].');
  });

  it('skips executable content and collapses HTML whitespace', () => {
    expect(
      htmlToReadableText(
        '<script>steal()</script><style>.hidden { display: none; }</style><p>Hello&nbsp;world</p>',
      ),
    ).toBe('Hello world');
  });

  it('caps long converted text and marks it as truncated', () => {
    const result = htmlToReadableText(`<p>${'a'.repeat(100_001)}</p>`);

    expect(result).toHaveLength(100_000);
    expect(result).toMatch(/\[Output truncated at 100,000 characters\.\]$/);
  });
});

describe('formatTimestamp', () => {
  it('renders the timestamp in the explicitly supplied timezone', () => {
    const result = formatTimestamp('2026-08-21T13:59:59Z', 'Australia/Sydney');

    expect(result).toContain('21 August 2026');
    expect(result).toContain('Australia/Sydney');
  });
});

describe('textResult', () => {
  it('wraps text in the MCP tool-result shape', () => {
    expect(textResult('Hello')).toEqual({
      content: [{ type: 'text', text: 'Hello' }],
    });
  });
});
