# Student document reading

Implement the first upgrade authorised in the student-product discussion: return useful document text through `canvas_read_file` without requiring the client to open a local temporary path.

Scope: PDFs with embedded text, DOCX main-body paragraphs (including tables), and PPTX slide text in presentation order. Include canonical Canvas source links and retrieval/update timestamps. Label PDF pages, Word paragraphs and PowerPoint slides. Clearly explain unsupported formats, corrupt/encrypted documents, image-only content and truncation. Keep the eleven-tool interface and existing GET-only download protections.

Implementation choices: parse locally with PDF.js, fflate and saxes; do not run macros, follow Office relationships to external resources, perform OCR, or add a model provider. Preserve temporary downloads as fallbacks and existing lifecycle cleanup. Keep Node >=20.19.0 compatibility. Bound extracted text to 100,000 characters, PDF pages/slides to 200, selected Office XML to 32 MiB in total and 8 MiB per part, and ZIP entry count to 2,000.

Files: add `src/documents/extract.ts` and `src/documents/office.ts`; integrate in `src/tools/file-tools.ts`; update the tool description and README; add generated synthetic document fixtures and end-to-end handler tests in `tests/document-reading.test.ts`.

- [x] Write handler tests against real PDF/DOCX/PPTX bytes; confirm failures before implementation.
- [x] Implement bounded extraction, source metadata and useful fallback messages.
- [x] Verify reordered slides, XML entities/tables, missing/corrupt parts, image-only PDF pages, truncation, unsupported formats, archive expansion limits and existing file-access protections.
- [x] Run full suite, lint, typecheck, build and packed-install checks; review the diff.

Baseline: 171 tests passed on Node 24.15.0. Existing installer changes in the original checkout are outside this isolated branch. This change is prepared locally; npm publication is a separate release action.

Verification: 186 tests passed on Node 24.15.0; formatting, lint, typecheck, build and package checks passed. The packed-install test now calls the actual MCP tool with PDF, DOCX and PPTX fixtures, proving runtime dependency resolution in a clean installation. Node 20.19 checks cover the document reader and packed installation.

Review: independent review found a nested Word text-box case that dropped surrounding text. A failing regression test reproduced it; paragraph-depth tracking fixed it. The reviewer verified the fix, with no remaining material findings.

Ruling: compatible runtime dependency updates were necessary after the baseline dependency check found existing advisories. Raised the SDK minimum to ^1.32.1 and html-to-text to ^10.0.1; refreshed compatible transitive dependencies. Runtime audit now reports zero advisories. Four existing development-tool advisories remain (three moderate, one low); no force or major dependency upgrade was applied.
