import JSZip from 'jszip';
import type { PhotoRecord } from './db';
import { saveReportBlob } from './save-file';

export interface FillFields {
  clientName: string;
  inspectionTitle: string;
  appendixLabel: string;
  projectReference: string;
}

export interface FillOptions {
  sessionName: string;
  photos: PhotoRecord[];
  layoutMode: 'three' | 'two' | 'optimize';
  fields: FillFields;
  footerTagline?: string;
  includeToc?: boolean;
  // Optional folder (File System Access API) to save the report into; falls back to download.
  saveDir?: any;
}

const EMU_PER_INCH = 914400;

// Original strings baked into the Acuren R3 template that we swap for per-report values.
const ORIG_CLIENT = 'Calgary Fuel Facilities Corporation (CFFC) c/o FSM Management Group Inc.';
const ORIG_TITLE = 'Tank 4 – Out-of-Service Inspection';
const ORIG_APPENDIX = 'Appendix D';
const ORIG_TAGLINE = 'A Higher Level of Reliability';
const ORIG_PROJREF =
  '208-J300295-61 CFFC C/O FSM Tank Management Group Inc Tank T-4 Out-of-Service (Generated using CAN-QUA-02F010 R07 05/10/2018';

function xmlEscape(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Build a STATIC table of contents block: a heading, one dotted-leader line per image with the
// real page number computed at export time, then a page break so photos start on a fresh page.
// Static text means it is correct the instant the file opens — no Word "update fields" step and
// no field codes ever appear in the document body.
function tocBlockXml(entries: { label: string; page: number }[]): string {
  const heading =
    '<w:p><w:pPr><w:spacing w:after="160"/><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>' +
    '<w:t>Table of Contents</w:t></w:r></w:p>';
  // Right tab stop at the content-width edge (page 12240 − left/right margins 1080 each).
  const lines = entries
    .map(
      (e) =>
        '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="10080"/></w:tabs>' +
        '<w:spacing w:after="80"/></w:pPr>' +
        `<w:r><w:t xml:space="preserve">${xmlEscape(e.label)}</w:t></w:r>` +
        `<w:r><w:tab/><w:t>${e.page}</w:t></w:r></w:p>`
    )
    .join('');
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  return heading + lines + pageBreak;
}

// Replace the text content of the first run that currently holds `orig` with `next`.
// Keeps all surrounding run/paragraph formatting intact.
function replaceText(xml: string, orig: string, next: string | undefined): string {
  if (next == null) return xml;
  const trimmed = next.trim();
  if (!trimmed) return xml; // leave template default when field left blank
  const escOrig = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // match <w:t ...>ORIG</w:t> (optional xml:space attr)
  const re = new RegExp('(<w:t[^>]*>)' + escOrig + '(</w:t>)');
  return xml.replace(re, '$1' + xmlEscape(trimmed) + '$2');
}

function isLandscape(photo: PhotoRecord): boolean {
  const w = photo?.width ?? 0;
  const h = photo?.height ?? 0;
  if (w > 0 && h > 0) return w > h; // square counts as portrait → favours 2/page
  return true; // unknown dimensions: assume landscape
}

// Decide how many photos share the page that starts at index `i`.
// optimize: 3 only when the next three are ALL landscape; otherwise 2 (at least one portrait).
function pageSizeAt(sorted: PhotoRecord[], i: number, mode: string): 2 | 3 {
  if (mode === 'two') return 2;
  if (mode === 'three') return 3;
  const remaining = sorted.length - i;
  if (remaining >= 3 && isLandscape(sorted[i]!) && isLandscape(sorted[i + 1]!) && isLandscape(sorted[i + 2]!)) {
    return 3;
  }
  return 2;
}

function extFor(blob: Blob): 'png' | 'jpeg' {
  const t = (blob?.type ?? '').toLowerCase();
  return t.includes('png') ? 'png' : 'jpeg';
}

// Fit image into the caption-row image cell, preserving aspect ratio. Returns EMU.
function imageExtent(photo: PhotoRecord, perPage: 2 | 3): { cx: number; cy: number } {
  const w = photo?.width ?? 800;
  const h = photo?.height ?? 600;
  const ratio = w > 0 && h > 0 ? w / h : 4 / 3;
  // Column width is fixed by the template (image cell ≈ 4.36"); fill it as much as cell padding allows.
  const maxWidthIn = 4.2;
  // 2/page images are taller, but kept so two rows always fit one physical page.
  const maxHeightIn = perPage === 2 ? 3.45 : 2.3;
  let wIn = maxWidthIn;
  let hIn = wIn / ratio;
  if (hIn > maxHeightIn) {
    hIn = maxHeightIn;
    wIn = hIn * ratio;
  }
  return { cx: Math.round(wIn * EMU_PER_INCH), cy: Math.round(hIn * EMU_PER_INCH) };
}

// Build the raw XML for one photo row from the extracted row template.
function buildRow(
  rowTemplate: string,
  opts: {
    imageNo: number;
    description: string;
    embedId: string;
    cx: number;
    cy: number;
    docPrId: number;
    perPage: 2 | 3;
  }
): string {
  let row = rowTemplate;
  row = row.replace(/<w:t>Image 1<\/w:t>/, `<w:t>Image ${opts.imageNo}</w:t>`);
  row = row.replace(
    /<w:t xml:space="preserve">Tank Overview <\/w:t>/,
    `<w:t xml:space="preserve">${xmlEscape(opts.description)}</w:t>`
  );
  row = row.replace(/r:embed="rId6"/, `r:embed="${opts.embedId}"`);
  // both <wp:extent> and <a:ext> carry the same cx/cy in the template
  row = row.replace(/cx="3800475" cy="2140582"/g, `cx="${opts.cx}" cy="${opts.cy}"`);
  row = row.replace(
    /<wp:docPr id="2091325614" name="Picture 13"\/>/,
    `<wp:docPr id="${opts.docPrId}" name="Picture ${opts.imageNo}"/>`
  );
  // adjust the exact row height for the layout
  row = row.replace(/<w:trHeight w:hRule="exact" w:val="3744"\/>/, `<w:trHeight w:hRule="exact" w:val="${opts.perPage === 2 ? 5600 : 3744}"/>`);
  return row;
}

// Fill the Acuren .docx template with the session's photos and report fields, preserving the
// template's exact header, footer, logo, fonts and page setup. Returns the completed .docx blob.
export async function fillDocx(baseBlob: Blob, opts: FillOptions): Promise<Blob> {
  const zip = await JSZip.loadAsync(baseBlob);

  // --- document.xml: rebuild the photo table ---
  const docPath = 'word/document.xml';
  let docXml = await zip.file(docPath)!.async('string');

  const tblMatch = docXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
  if (!tblMatch) throw new Error('Template body table not found');
  const tbl = tblMatch[0];
  const headEnd = tbl.indexOf('<w:tr');
  const tableHead = tbl.slice(0, headEnd); // <w:tbl> + tblPr + tblGrid
  const firstRow = tbl.match(/<w:tr[\s\S]*?<\/w:tr>/)![0];

  const sorted = [...(opts.photos ?? [])].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));

  // Prepare relationships + content types additions.
  const relsPath = 'word/_rels/document.xml.rels';
  let relsXml = await zip.file(relsPath)!.async('string');
  const relAdditions: string[] = [];

  // Build one row per photo. A single table lets the fixed row heights paginate naturally
  // (exactly how the original template yields 3 photos per page) with no manual page breaks.
  const rowsXml: string[] = [];
  const tocEntries: { label: string; page: number }[] = [];
  let i = 0;
  let imageNo = 1;
  let docPrId = 900000000;
  let mediaIdx = 0;
  // The table of contents occupies page 1, so the first photo page is page 2.
  let pageNo = 2;

  while (i < sorted.length) {
    const perPage = pageSizeAt(sorted, i, opts.layoutMode);
    for (let j = 0; j < perPage && i < sorted.length; j++, i++) {
      const photo = sorted[i]!;
      const blob = photo?.annotatedBlob ?? photo?.blob;
      if (!blob) { continue; }
      const ext = extFor(blob);
      const fileName = `photo${mediaIdx + 1}.${ext}`;
      const buf = await blob.arrayBuffer();
      zip.file(`word/media/${fileName}`, buf);
      const embedId = `rIdPhoto${mediaIdx + 1}`;
      relAdditions.push(
        `<Relationship Id="${embedId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`
      );
      const { cx, cy } = imageExtent(photo, perPage);
      const descText = photo?.description?.trim();
      const desc = descText || `Image ${imageNo}`;
      if (opts.includeToc) {
        tocEntries.push({
          label: descText ? `Image ${imageNo} – ${descText}` : `Image ${imageNo}`,
          page: pageNo,
        });
      }
      rowsXml.push(
        buildRow(firstRow, {
          imageNo,
          description: desc,
          embedId,
          cx,
          cy,
          docPrId: docPrId++,
          perPage,
        })
      );
      imageNo++;
      mediaIdx++;
    }
    pageNo++;
  }

  const tableXml =
    rowsXml.length === 0
      ? '<w:p><w:pPr><w:pStyle w:val="NoSpacing"/></w:pPr><w:r><w:t>No photos in this report.</w:t></w:r></w:p>'
      : tableHead + rowsXml.join('') + '</w:tbl>';

  // Prepend a pre-computed Table of Contents (own page) when requested and there are photos.
  const bodyXml =
    opts.includeToc && rowsXml.length > 0 ? tocBlockXml(tocEntries) + tableXml : tableXml;

  docXml = docXml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/, bodyXml);

  // Fill header fields (header1.xml) and footer fields (footer1.xml).
  const headerPath = 'word/header1.xml';
  if (zip.file(headerPath)) {
    let h = await zip.file(headerPath)!.async('string');
    h = replaceText(h, ORIG_CLIENT, opts.fields.clientName);
    h = replaceText(h, ORIG_TITLE, opts.fields.inspectionTitle);
    h = replaceText(h, ORIG_APPENDIX, opts.fields.appendixLabel);
    zip.file(headerPath, h);
  }
  const footerPath = 'word/footer1.xml';
  if (zip.file(footerPath)) {
    let f = await zip.file(footerPath)!.async('string');
    f = replaceText(f, ORIG_TAGLINE, opts.footerTagline);
    f = replaceText(f, ORIG_PROJREF, opts.fields.projectReference);
    zip.file(footerPath, f);
  }

  // Write relationships.
  relsXml = relsXml.replace('</Relationships>', relAdditions.join('') + '</Relationships>');
  zip.file(relsPath, relsXml);
  zip.file(docPath, docXml);

  return zip.generateAsync({ type: 'blob', mimeType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export async function fillDocxAndSave(
  baseBlob: Blob,
  opts: FillOptions
): Promise<'folder' | 'download'> {
  const blob = await fillDocx(baseBlob, opts);
  const name = (opts.sessionName || 'report').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'report';
  return saveReportBlob(blob, `${name}_Photo_Report.docx`, opts.saveDir);
}
