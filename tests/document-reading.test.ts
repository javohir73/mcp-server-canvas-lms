import { afterEach, describe, expect, it } from 'vitest';
import { CanvasClient } from '../src/canvas/client.js';
import { cleanupDownloads } from '../src/canvas/download.js';
import { createFileHandlers } from '../src/tools/file-tools.js';
import {
  officeDocument,
  pdfDocument,
  presentationDocument,
  wordDocument,
} from './fixtures/documents.js';

afterEach(cleanupDownloads);

async function readDocument(
  name: string,
  bytes: Uint8Array,
  contentType = 'application/octet-stream',
): Promise<string> {
  const file = {
    id: 803,
    filename: name,
    display_name: name,
    content_type: contentType,
    size: bytes.length,
    updated_at: '2026-10-20T00:00:00Z',
    url: 'https://canvas.example.edu/files/803/download?secret=signed-download-value',
  };
  const config = {
    baseUrl: new URL('https://canvas.example.edu'),
    apiToken: 'fictional-document-token',
    maxPages: 20,
    timeoutMs: 15000,
  };
  const apiFetch: typeof fetch = async (url) =>
    new Response(
      JSON.stringify(String(url).includes('/courses/') ? [file] : file),
      { headers: { 'Content-Type': 'application/json' } },
    );
  const handlers = createFileHandlers({
    client: new CanvasClient(config, apiFetch),
    canvasOrigin: config.baseUrl,
    apiToken: config.apiToken,
    timezone: 'Australia/Sydney',
    now: () => new Date('2026-10-21T00:00:00Z'),
    downloadFetch: async () => new Response(new Uint8Array(bytes)),
  });
  const result = await handlers.readFile({ course_id: 101, file_id: 803 });
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

describe('course document reading', () => {
  it('returns actual PDF text with page references and canonical source metadata', async () => {
    const text = await readDocument(
      'assessment.pdf',
      pdfDocument([
        'Write a 2000 word report.',
        'Rubric: analysis 60 percent.',
      ]),
      'application/pdf',
    );
    expect(text).toContain('Page 1');
    expect(text).toContain('Write a 2000 word report.');
    expect(text).toContain('Page 2');
    expect(text).toContain('Rubric: analysis 60 percent.');
    expect(text).toContain(
      'Canvas: https://canvas.example.edu/courses/101/files/803/preview',
    );
    expect(text).toContain('Retrieved: 2026-10-21T00:00:00.000Z');
    expect(text).toContain('Updated: 2026-10-20T00:00:00Z');
    expect(text).not.toContain('signed-download-value');
    expect(text).not.toContain('Temporary path:');
  });

  it('reads Word paragraphs and table cells, decoding entities and keeping line breaks', async () => {
    const text = await readDocument(
      'Brief.DOCX',
      wordDocument(
        '<w:p><w:r><w:t>Research &amp; reflection</w:t><w:tab/><w:t>Required</w:t><w:br/><w:t>Use evidence.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Analysis: 60%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      ),
    );
    expect(text).toContain('Paragraph 1');
    expect(text).toContain('Research & reflection\tRequired\nUse evidence.');
    expect(text).toContain('Paragraph 2');
    expect(text).toContain('Analysis: 60%');
    expect(text).not.toContain('<w:');
  });

  it('reads PowerPoint in presentation order rather than filename order', async () => {
    const text = await readDocument('Week 1.pptx', presentationDocument());
    expect(text).toContain('Slide 1\nFirst: learning objectives');
    expect(text).toContain('Slide 2\nSecond: compare & contrast');
    expect(text).not.toContain('Private speaker notes');
  });

  it('preserves requirements around a Word text box containing nested paragraphs', async () => {
    const text = await readDocument(
      'text-box.docx',
      wordDocument(
        '<w:p><w:r><w:t>Main requirement before box.</w:t></w:r><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Box text.</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r><w:r><w:t>Main requirement after box.</w:t></w:r></w:p>',
      ),
    );
    expect(text).toContain(
      'Main requirement before box.\nBox text.\nMain requirement after box.',
    );
  });

  it('identifies pages without extractable text while preserving readable pages', async () => {
    const text = await readDocument(
      'scan.pdf',
      pdfDocument(['', 'Readable second page.']),
    );
    expect(text).toContain('Page 1\n[No extractable text');
    expect(text).toContain('Readable second page.');
    expect(text).toMatch(/OCR/i);
  });

  it('clearly reports corrupt documents and leaves the downloaded file as a fallback', async () => {
    const text = await readDocument(
      'corrupt.pdf',
      new TextEncoder().encode('invalid PDF: secret-parser-details'),
    );
    expect(text).toContain('Text extraction unavailable');
    expect(text).toContain('Temporary path:');
    expect(text).not.toContain('secret-parser-details');
  });

  it('explains that old Office formats are unsupported', async () => {
    const text = await readDocument('old-brief.doc', new Uint8Array([1, 2, 3]));
    expect(text).toContain(
      'Text extraction is not supported for this file type',
    );
    expect(text).toContain('Temporary path:');
  });

  it('marks truncation rather than presenting an incomplete document as complete', async () => {
    const text = await readDocument(
      'long.docx',
      wordDocument(`<w:p><w:r><w:t>${'a'.repeat(100001)}</w:t></w:r></w:p>`),
    );
    expect(text).toContain('[Output truncated');
    expect(text.length).toBeLessThan(101000);
    expect(text).not.toContain('Temporary path:');
  });

  it('rejects Office XML expansion beyond the extraction budget', async () => {
    const text = await readDocument(
      'oversized.docx',
      wordDocument(
        `<w:p><w:r><w:t>${'a'.repeat(8 * 1024 * 1024)}</w:t></w:r></w:p>`,
      ),
    );
    expect(text).toContain('Text extraction unavailable');
    expect(text.length).toBeLessThan(2000);
  });

  it('rejects document type declarations without exposing entity contents', async () => {
    const text = await readDocument(
      'entities.docx',
      officeDocument({
        'word/document.xml':
          '<!DOCTYPE x [<!ENTITY secret "DO_NOT_RETURN_THIS">]><w:document xmlns:w="urn:word"><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:document>',
      }),
    );
    expect(text).toContain('Text extraction unavailable');
    expect(text).not.toContain('DO_NOT_RETURN_THIS');
  });

  it('reports missing slide parts rather than silently omitting a slide', async () => {
    const text = await readDocument(
      'broken.pptx',
      officeDocument({
        'ppt/presentation.xml':
          '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
        'ppt/_rels/presentation.xml.rels':
          '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>',
      }),
    );
    expect(text).toContain('Text extraction unavailable');
  });

  it('resolves slide relationship namespaces independently of the chosen XML prefix', async () => {
    const text = await readDocument(
      'alternate-prefix.pptx',
      officeDocument({
        'ppt/presentation.xml':
          '<p:presentation xmlns:p="urn:p" xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId rel:id="rId1"/></p:sldIdLst></p:presentation>',
        'ppt/_rels/presentation.xml.rels':
          '<Relationships><Relationship Id="rId1" Target="slides/slide3.xml"/></Relationships>',
        'ppt/slides/slide3.xml':
          '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Alternate prefix content</a:t></a:r></a:p></p:sld>',
      }),
    );
    expect(text).toContain('Slide 1\nAlternate prefix content');
  });

  it('stops PDF extraction after 200 pages and discloses the unread remainder', async () => {
    const pages = Array.from(
      { length: 201 },
      (_, i) => `Content for page ${i + 1}.`,
    );
    const text = await readDocument('large.pdf', pdfDocument(pages));
    expect(text).toContain('Content for page 200.');
    expect(text).not.toContain('Content for page 201.');
    expect(text).toContain('[Output truncated');
  });

  it('rejects excessive ZIP entries even when the extra entries are not selected', async () => {
    const parts = Object.fromEntries(
      Array.from({ length: 2001 }, (_, i) => [`unused/${i}`, '']),
    );
    const text = await readDocument('many-files.docx', officeDocument(parts));
    expect(text).toContain('Text extraction unavailable');
  });

  it('rejects malformed Word XML rather than returning partial text as complete', async () => {
    const text = await readDocument(
      'broken.docx',
      officeDocument({
        'word/document.xml':
          '<w:document><w:p><w:r><w:t>Partial content</w:t></w:r></w:p>',
      }),
    );
    expect(text).toContain('Text extraction unavailable');
    expect(text).not.toContain('Partial content');
  });
});
