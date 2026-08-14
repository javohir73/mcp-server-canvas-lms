import type { CanvasFile } from '../canvas/types.js';
import { CanvasError } from '../canvas/errors.js';
import {
  downloadCanvasFile,
  type TemporaryDirectoryFactory,
} from '../canvas/download.js';
import { textResult } from '../format/text.js';
import type { Handler, ToolDependencies } from './types.js';

export interface FileHandlers {
  readonly listFiles: Handler<{ course_id: number; search?: string }>;
  readonly readFile: Handler<{ course_id: number; file_id: number }>;
}

export interface FileToolDependencies extends ToolDependencies {
  readonly canvasOrigin: URL;
  readonly apiToken: string;
  readonly downloadFetch?: typeof fetch;
  readonly createTempDirectory?: TemporaryDirectoryFactory;
}

export function createFileHandlers(
  dependencies: FileToolDependencies,
): FileHandlers {
  const { client } = dependencies;

  return {
    async listFiles({ course_id, search }) {
      requirePositiveInteger(course_id, 'course_id');
      if (search !== undefined && typeof search !== 'string') {
        throw new TypeError('search must be a string');
      }
      const files = await client.getAll<CanvasFile>(
        `/courses/${String(course_id)}/files`,
        {
          search_term: search,
          sort: 'name',
          order: 'asc',
          per_page: 100,
        },
      );
      return textResult(formatFileList(files));
    },

    async readFile({ course_id, file_id }) {
      requirePositiveInteger(course_id, 'course_id');
      requirePositiveInteger(file_id, 'file_id');
      const courseFiles = await client.getAll<CanvasFile>(
        `/courses/${String(course_id)}/files`,
        { per_page: 100 },
      );
      if (!courseFiles.some((file) => file.id === file_id)) {
        throw new CanvasError(
          'NOT_FOUND',
          'Canvas file was not found in this course',
        );
      }

      const file = await client.get<CanvasFile>(`/files/${String(file_id)}`);
      if (file.id !== file_id) {
        throw new CanvasError(
          'BAD_RESPONSE',
          'Canvas returned mismatched file metadata',
        );
      }
      const result = await downloadCanvasFile(file, {
        canvasOrigin: dependencies.canvasOrigin,
        apiToken: dependencies.apiToken,
        ...(dependencies.downloadFetch
          ? { fetchImpl: dependencies.downloadFetch }
          : {}),
        ...(dependencies.createTempDirectory
          ? { createTempDirectory: dependencies.createTempDirectory }
          : {}),
      });
      return textResult(formatReadFile(file, result));
    },
  };
}

function formatFileList(files: readonly CanvasFile[]): string {
  if (files.length === 0) return 'No Canvas files found for this course.';
  return ['Canvas files', ...files.map(formatFileSummary)].join('\n\n');
}

function formatFileSummary(file: CanvasFile): string {
  return [
    `File: ${displayName(file)}`,
    `File ID: ${String(file.id)}`,
    `MIME type: ${file.content_type ?? 'not provided'}`,
    `Size: ${file.size === undefined ? 'not provided' : `${String(file.size)} bytes`}`,
    ...(file.preview_url ? [`Canvas: ${file.preview_url}`] : []),
  ].join('\n');
}

function formatReadFile(
  file: CanvasFile,
  result: Awaited<ReturnType<typeof downloadCanvasFile>>,
): string {
  const details = [
    result.kind === 'inline' ? 'Canvas file' : 'Canvas file downloaded',
    `File: ${result.name}`,
    `File ID: ${String(file.id)}`,
    `MIME type: ${result.mimeType}`,
  ];
  if (result.kind === 'inline') {
    return [...details, '', result.text].join('\n');
  }
  return [
    ...details,
    `Size: ${String(result.size)} bytes`,
    `Temporary path: ${result.path}`,
  ].join('\n');
}

function displayName(file: CanvasFile): string {
  return file.display_name ?? file.filename ?? `canvas-file-${String(file.id)}`;
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
}
