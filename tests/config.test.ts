import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('normalizes a valid Canvas origin', () => {
    const config = loadConfig({
      CANVAS_BASE_URL: 'https://canvas.example.edu/',
      CANVAS_API_TOKEN: 'secret-value',
    });
    expect(config.baseUrl.href).toBe('https://canvas.example.edu/');
    expect(config.apiToken).toBe('secret-value');
    expect(config.timeoutMs).toBe(15_000);
    expect(config.maxPages).toBe(20);
  });

  it.each([
    '',
    'canvas.example.edu',
    'http://canvas.example.edu',
    'https://user:pass@canvas.example.edu',
    'https://canvas.example.edu/api/v1',
  ])('rejects unsafe base URL %s', (baseUrl) => {
    expect(() =>
      loadConfig({
        CANVAS_BASE_URL: baseUrl,
        CANVAS_API_TOKEN: 'secret-value',
      }),
    ).toThrow(/CANVAS_BASE_URL/);
  });

  it('does not expose the token in errors', () => {
    const token = 'never-print-this-token';
    try {
      loadConfig({ CANVAS_BASE_URL: 'invalid', CANVAS_API_TOKEN: token });
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });
});
