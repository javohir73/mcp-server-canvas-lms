import { posix } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { DocumentText } from './text.js';

const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_XML_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_SLIDES = 200;

export function extractOfficeText(
  bytes: Uint8Array,
  format: 'docx' | 'pptx',
): string {
  const parts = readParts(bytes, format);
  const output = new DocumentText();
  if (format === 'docx') {
    let paragraph = 0;
    readParagraphs(requiredPart(parts, 'word/document.xml'), (text) => {
      paragraph += 1;
      output.add(`Paragraph ${String(paragraph)}`, text);
    });
  } else {
    const relationships = new Map<string, string>();
    parseXml(requiredPart(parts, 'ppt/_rels/presentation.xml.rels'), (tag) => {
      if (localName(tag.name) !== 'Relationship') return;
      const Id = tag.attributes.Id?.value;
      const Target = tag.attributes.Target?.value;
      const TargetMode = tag.attributes.TargetMode?.value;
      if (!Id || !Target || TargetMode === 'External') return;
      const target = Target.startsWith('/')
        ? posix.normalize(Target.slice(1))
        : posix.normalize(posix.join('ppt', Target));
      if (/^ppt\/slides\/slide\d+\.xml$/.test(target))
        relationships.set(Id, target);
    });
    const slideIds: string[] = [];
    parseXml(requiredPart(parts, 'ppt/presentation.xml'), (tag) => {
      if (localName(tag.name) !== 'sldId') return;
      const id = Object.values(tag.attributes).find(
        (attribute) =>
          attribute.local === 'id' &&
          (attribute.uri ===
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships' ||
            attribute.uri ===
              'http://purl.oclc.org/ooxml/officeDocument/relationships'),
      )?.value;
      if (!id) throw new Error('Missing slide relationship');
      slideIds.push(id);
    });
    for (const [index, id] of slideIds.slice(0, MAX_SLIDES).entries()) {
      if (output.full) {
        output.markTruncated();
        break;
      }
      const target = relationships.get(id);
      if (!target) throw new Error('Missing slide part');
      const paragraphs: string[] = [];
      readParagraphs(requiredPart(parts, target), (text) =>
        paragraphs.push(text),
      );
      output.add(
        `Slide ${String(index + 1)}`,
        paragraphs.join('\n') ||
          '[No extractable text; this slide may contain images or diagrams.]',
      );
    }
    if (slideIds.length > MAX_SLIDES) output.markTruncated();
  }
  return (
    output.toString() ||
    '[No extractable text. This document may contain images; OCR is not included.]'
  );
}

function readParts(
  bytes: Uint8Array,
  format: 'docx' | 'pptx',
): Record<string, Uint8Array> {
  let entries = 0;
  let expandedBytes = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      entries += 1;
      if (entries > MAX_ZIP_ENTRIES)
        throw new Error('Too many archive entries');
      const selected =
        format === 'docx'
          ? file.name === 'word/document.xml'
          : /^(?:ppt\/presentation\.xml|ppt\/_rels\/presentation\.xml\.rels|ppt\/slides\/slide\d+\.xml)$/.test(
              file.name,
            );
      if (!selected) return false;
      expandedBytes += file.originalSize;
      if (file.originalSize > MAX_PART_BYTES || expandedBytes > MAX_XML_BYTES)
        throw new Error('Office XML exceeds extraction limits');
      return true;
    },
  });
}

function requiredPart(parts: Record<string, Uint8Array>, name: string): string {
  const bytes = parts[name];
  if (!bytes || bytes.length > MAX_PART_BYTES)
    throw new Error('Invalid Office part');
  return strFromU8(bytes);
}

function readParagraphs(xml: string, add: (text: string) => void): void {
  const parser = xmlParser();
  let paragraph: string | undefined;
  let paragraphDepth = 0;
  let inText = false;
  const append = (text: string): void => {
    // Keep at most enough characters to trigger the public output limit.
    if (paragraph !== undefined && paragraph.length <= 100_000)
      paragraph += text.slice(0, 100_001 - paragraph.length);
  };
  parser.on('opentag', (tag) => {
    const name = localName(tag.name);
    if (name === 'p') {
      if (paragraphDepth === 0) paragraph = '';
      else append('\n');
      paragraphDepth += 1;
    }
    if (name === 't') inText = true;
    if (name === 'tab') append('\t');
    if (name === 'br' || name === 'cr') append('\n');
  });
  parser.on('text', (text) => {
    if (inText) append(text);
  });
  parser.on('cdata', (text) => {
    if (inText) append(text);
  });
  parser.on('closetag', (tag) => {
    const name = localName(tag.name);
    if (name === 't') inText = false;
    if (name === 'p') {
      paragraphDepth -= 1;
      if (paragraphDepth === 0) {
        if (paragraph?.trim()) add(paragraph.trim());
        paragraph = undefined;
      } else append('\n');
    }
  });
  parser.write(xml).close();
}

function parseXml(xml: string, onTag: (tag: SaxesTagNS) => void): void {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw new Error('Document type declarations are unsupported');
  });
  parser.on('opentag', onTag);
  parser.write(xml).close();
}

function xmlParser(): SaxesParser<{ xmlns: false }> {
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => {
    throw new Error('Document type declarations are unsupported');
  });
  return parser;
}

function localName(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1);
}
