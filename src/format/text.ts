import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type TextResult = CallToolResult;

export function formatTimestamp(timestamp: string, timezone: string): string {
  const formatted = new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: timezone,
  }).format(new Date(timestamp));
  return `${formatted} (${timezone})`;
}

export function textResult(text: string): TextResult {
  return { content: [{ type: 'text', text }] };
}
