import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { DownloadedFile } from '../canvas/download.js';
import { extractOfficeText } from './office.js';
import { DocumentText } from './text.js';

export interface DocumentExtraction {
  readonly text?: string;
  readonly notice: string;
}

export async function extractDocument(
  file: DownloadedFile,
): Promise<DocumentExtraction> {
  const format = documentFormat(file);
  if (!format)
    return {
      notice:
        'Text extraction is not supported for this file type. Open the original file in Canvas or use the downloaded copy.',
    };
  try {
    const bytes = new Uint8Array(await readFile(file.path));
    const text =
      format === 'pdf'
        ? await extractPdfText(bytes)
        : extractOfficeText(bytes, format);
    return {
      text,
      notice: `Extraction: text only; images, diagrams${format === 'pptx' ? ', speaker notes' : ''} and original layout are not included. OCR is not included.${format === 'docx' ? ' Word references identify main-body paragraphs, including table cells; headers, footers and comments are not included.' : ''}`,
    };
  } catch {
    return {
      notice:
        'Text extraction unavailable. The file may be damaged, encrypted, or exceed extraction limits. Open the original file in Canvas or use the downloaded copy.',
    };
  }
}

function documentFormat(
  file: DownloadedFile,
): 'pdf' | 'docx' | 'pptx' | undefined {
  const mime = file.mimeType.split(';')[0]?.trim().toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (
    mime ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx';
  if (
    mime ===
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )
    return 'pptx';
  const extension = extname(file.name).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.docx') return 'docx';
  if (extension === '.pptx') return 'pptx';
  return undefined;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: bytes,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const output = new DocumentText();
    const pageLimit = Math.min(pdf.numPages, 200);
    for (let number = 1; number <= pageLimit; number += 1) {
      if (output.full) {
        output.markTruncated();
        break;
      }
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((item) =>
            'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
          )
          .join('')
          .trim();
        output.add(
          `Page ${String(number)}`,
          text ||
            '[No extractable text; this page may be scanned or image-only. OCR is not included.]',
        );
      } finally {
        page.cleanup();
      }
    }
    if (pdf.numPages > pageLimit) output.markTruncated();
    return output.toString();
  } finally {
    await task.destroy();
  }
}
