import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type TextResult = CallToolResult;

export function parseTimestamp(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

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
