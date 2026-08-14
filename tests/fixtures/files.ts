import type { CanvasFile } from '../../src/canvas/types.js';

export const courseFiles: readonly CanvasFile[] = [
  {
    id: 801,
    display_name: 'Week 1 notes.md',
    filename: 'week-1-notes.md',
    content_type: 'text/markdown; charset=utf-8',
    url: 'https://canvas.example.edu/files/801/download?download_frd=1',
    preview_url: 'https://canvas.example.edu/courses/101/files/801/preview',
    size: 31,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    folder: { id: 71, name: 'Course files' },
  },
  {
    id: 802,
    display_name: 'Field guide.html',
    filename: 'field-guide.html',
    content_type: 'text/html; charset=UTF-8',
    url: 'https://canvas.example.edu/files/802/download',
    preview_url: 'https://canvas.example.edu/courses/101/files/802/preview',
    size: 91,
    created_at: '2026-08-03T00:00:00Z',
    updated_at: '2026-08-04T00:00:00Z',
    folder: { id: 71, name: 'Course files' },
  },
  {
    id: 803,
    display_name: 'Dragon map 🗺️.pdf',
    filename: 'dragon map 🗺️.pdf',
    content_type: 'application/pdf',
    url: 'https://canvas.example.edu/files/803/download',
    preview_url: 'https://canvas.example.edu/courses/101/files/803/preview',
    size: 4096,
    created_at: '2026-08-05T00:00:00Z',
    updated_at: '2026-08-06T00:00:00Z',
    folder: { id: 72, name: 'Maps' },
  },
] as const;

export const refreshedTextFile: CanvasFile = {
  ...courseFiles[0]!,
  display_name: 'Current week 1 notes.md',
  filename: 'current-week-1-notes.md',
  size: 31,
};

export const refreshedHtmlFile: CanvasFile = {
  ...courseFiles[1]!,
};

export const refreshedBinaryFile: CanvasFile = {
  ...courseFiles[2]!,
};
