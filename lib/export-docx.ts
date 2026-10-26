import {
  Document,
  Packer,
  Paragraph,
  ImageRun,
  TextRun,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
  VerticalAlign,
  TableLayoutType,
  TabStopType,
  TabStopPosition,
  LeaderType,
  Tab,
} from 'docx';
import { saveReportBlob } from './save-file';
import type { PhotoRecord } from './db';

export interface ReportBranding {
  logoBuffer: ArrayBuffer | null;
  logoType: 'png' | 'jpg';
  footerTagline: string;
  accentColor: string; // hex without '#'
}

export interface ReportFields {
  clientName: string;
  inspectionTitle: string;
  appendixLabel: string;
  projectReference: string;
}

interface ExportOptions {
  sessionName: string;
  photos: PhotoRecord[];
  layoutMode: 'three' | 'two' | 'optimize';
  branding: ReportBranding;
  fields: ReportFields;
  includeToc?: boolean;
  // Optional folder (File System Access API) to save the report into; falls back to download.
  saveDir?: any;
}

const GREY = '595959';

type ImgType = 'png' | 'jpg';

interface PhotoWithBuffer {
  photo: PhotoRecord;
  buffer: ArrayBuffer;
  type: ImgType;
}

function detectType(blob: Blob): ImgType {
  const t = (blob?.type ?? '').toLowerCase();
  if (t.includes('png')) return 'png';
  return 'jpg';
}

function isLandscape(photo: PhotoRecord): boolean {
  const w = photo?.width ?? 0;
  const h = photo?.height ?? 0;
  if (w > 0 && h > 0) return w > h; // square counts as portrait → favours 2/page
  return true; // unknown dimensions: assume landscape
}

// optimize: 3/page only when the next three are ALL landscape; otherwise 2/page. three/two fixed.
function pageSizeAt(photos: PhotoRecord[], i: number, mode: string): 2 | 3 {
  if (mode === 'two') return 2;
  if (mode === 'three') return 3;
  const remaining = photos.length - i;
  if (remaining >= 3 && isLandscape(photos[i]!) && isLandscape(photos[i + 1]!) && isLandscape(photos[i + 2]!)) {
    return 3;
  }
  return 2;
}

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

// Letterhead: logo on top, then client/title (left) and appendix/page (right), with an accent rule.
function buildHeader(branding: ReportBranding, fields: ReportFields): Header {
  const accent = branding.accentColor || '0A2A5E';

  const logoParagraph = new Paragraph({
    spacing: { after: 60 },
    children: branding.logoBuffer
      ? [
          new ImageRun({
            data: branding.logoBuffer,
            transformation: { width: 150, height: 98 },
            type: branding.logoType,
          }),
        ]
      : [new TextRun({ text: 'ACUREN', font: 'Calibri', size: 40, bold: true, color: accent })],
  });

  const leftChildren: Paragraph[] = [];
  if (fields.clientName?.trim()) {
    leftChildren.push(
      new Paragraph({
        spacing: { after: 10 },
        children: [new TextRun({ text: fields.clientName.trim(), font: 'Calibri', size: 22, bold: true })],
      })
    );
  }
  if (fields.inspectionTitle?.trim()) {
    leftChildren.push(
      new Paragraph({
        children: [new TextRun({ text: fields.inspectionTitle.trim(), font: 'Calibri', size: 20 })],
      })
    );
  }
  if (leftChildren.length === 0) {
    leftChildren.push(new Paragraph({ children: [] }));
  }

  const rightChildren: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 10 },
      children: [
        new TextRun({
          text: fields.appendixLabel?.trim() || '',
          font: 'Calibri',
          size: 22,
          bold: true,
          italics: true,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: 'Page ', font: 'Calibri', size: 20 }),
        new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 20 }),
        new TextRun({ text: ' of ', font: 'Calibri', size: 20 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', size: 20 }),
      ],
    }),
  ];

  const infoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    columnWidths: [convertInchesToTwip(4.6), convertInchesToTwip(2.4)],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            verticalAlign: VerticalAlign.BOTTOM,
            borders: NO_BORDERS,
            children: leftChildren,
          }),
          new TableCell({
            verticalAlign: VerticalAlign.BOTTOM,
            borders: NO_BORDERS,
            children: rightChildren,
          }),
        ],
      }),
    ],
  });

  return new Header({
    children: [
      logoParagraph,
      infoTable,
      new Paragraph({
        spacing: { before: 40, after: 0 },
        border: { bottom: { color: accent, space: 2, style: BorderStyle.SINGLE, size: 12 } },
        children: [],
      }),
    ],
  });
}

function buildFooter(branding: ReportBranding, fields: ReportFields): Footer {
  const accent = branding.accentColor || '0A2A5E';
  const runs: TextRun[] = [
    new TextRun({ text: branding.footerTagline || '', font: 'Calibri', size: 18, bold: true, color: accent }),
  ];
  if (fields.projectReference?.trim()) {
    runs.push(
      new TextRun({ text: '   ' + fields.projectReference.trim(), font: 'Calibri', size: 14, color: GREY })
    );
  }
  return new Footer({
    children: [new Paragraph({ spacing: { before: 20 }, children: runs })],
  });
}

// One photo row: caption cell on the left, image cell on the right.
function buildPhotoRow(item: PhotoWithBuffer, index: number, perPage: 2 | 3, includeToc = false): Table {
  const { photo, buffer, type } = item;
  const pw = photo?.width ?? 800;
  const ph = photo?.height ?? 600;
  const ratio = pw > 0 && ph > 0 ? pw / ph : 4 / 3;

  const maxWidthIn = 4.7;
  const maxHeightIn = perPage === 2 ? 3.45 : 2.4;
  let wIn = maxWidthIn;
  let hIn = wIn / ratio;
  if (hIn > maxHeightIn) {
    hIn = maxHeightIn;
    wIn = hIn * ratio;
  }
  const widthPx = Math.round(wIn * 96);
  const heightPx = Math.round(hIn * 96);

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    columnWidths: [convertInchesToTwip(1.8), convertInchesToTwip(5.2)],
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            verticalAlign: VerticalAlign.CENTER,
            borders: NO_BORDERS,
            margins: { top: 0, bottom: 0, left: 0, right: 120 },
            children: [
              new Paragraph({
                spacing: { after: 20 },
                // outlineLevel lets the Table of Contents field pick up this caption as an entry.
                ...(includeToc ? { outlineLevel: 0 } : {}),
                children: [new TextRun({ text: `Image ${index}`, font: 'Calibri', size: 22, bold: true })],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: photo?.description?.trim() || `Photo ${index}`,
                    font: 'Calibri',
                    size: 22,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            verticalAlign: VerticalAlign.CENTER,
            borders: NO_BORDERS,
            children: [
              new Paragraph({
                children: [
                  new ImageRun({
                    data: buffer,
                    transformation: { width: widthPx, height: heightPx },
                    type,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export async function exportToDocx(options: ExportOptions): Promise<'folder' | 'download'> {
  const { sessionName, photos, layoutMode, branding, fields, includeToc = false, saveDir } = options;
  const sortedPhotos = [...(photos ?? [])].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));

  // Load all photo buffers.
  const items: PhotoWithBuffer[] = [];
  for (const photo of sortedPhotos) {
    const blob = photo?.annotatedBlob ?? photo?.blob;
    if (!blob) continue;
    const buffer = await blob.arrayBuffer();
    items.push({ photo, buffer, type: detectType(blob) });
  }

  // Build body: photo rows grouped into pages with explicit page breaks.
  const body: (Table | Paragraph)[] = [];
  const tocEntries: { label: string; page: number }[] = [];
  let i = 0;
  let imageNo = 1;
  let firstPage = true;
  // When a TOC is prepended it takes page 1, so the first photo page is page 2; otherwise page 1.
  let pageNo = includeToc ? 2 : 1;
  while (i < items.length) {
    const groupPerPage = pageSizeAt(items.map((it) => it.photo), i, layoutMode);
    if (!firstPage) {
      body.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, children: [] }));
    }
    firstPage = false;
    for (let j = 0; j < groupPerPage && i < items.length; j++, i++) {
      const descText = items[i]!.photo?.description?.trim();
      if (includeToc) {
        tocEntries.push({
          label: descText ? `Image ${imageNo} – ${descText}` : `Image ${imageNo}`,
          page: pageNo,
        });
      }
      body.push(buildPhotoRow(items[i]!, imageNo, groupPerPage, includeToc));
      body.push(new Paragraph({ spacing: { after: 180 }, children: [] }));
      imageNo++;
    }
    pageNo++;
  }

  if (body.length === 0) {
    body.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
        children: [new TextRun({ text: 'No photos in this report.', font: 'Calibri', size: 22, color: GREY })],
      })
    );
  }

  // Optional: prepend a pre-computed Table of Contents on its own first page. Page numbers are
  // calculated at export time (static text), so the table is correct the moment the file opens.
  const children: (Table | Paragraph)[] =
    includeToc && items.length > 0
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [new TextRun({ text: 'Table of Contents', font: 'Calibri', size: 28, bold: true })],
          }),
          ...tocEntries.map(
            (e) =>
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: LeaderType.DOT }],
                spacing: { after: 80 },
                children: [
                  new TextRun({ text: e.label, font: 'Calibri', size: 22 }),
                  new TextRun({ children: [new Tab()] }),
                  new TextRun({ text: String(e.page), font: 'Calibri', size: 22 }),
                ],
              })
          ),
          new Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, children: [] }),
          ...body,
        ]
      : body;

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(2.0),
              right: convertInchesToTwip(0.75),
              bottom: convertInchesToTwip(0.7),
              left: convertInchesToTwip(0.75),
            },
          },
        },
        headers: { default: buildHeader(branding, fields) },
        footers: { default: buildFooter(branding, fields) },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const name = sessionName?.replace(/[^a-zA-Z0-9]/g, '_') ?? 'report';
  return saveReportBlob(blob, `${name}_Photo_Report.docx`, saveDir);
}
