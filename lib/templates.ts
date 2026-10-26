import JSZip from 'jszip';
import { db, type TemplateRecord } from './db';

export const DEFAULT_ACCENT = '0A2A5E';
export const DEFAULT_TAGLINE = 'A Higher Level of Reliability';

// Normalise a hex colour to 6 chars without '#'.
export function normalizeHex(input: string | undefined): string {
  let h = (input ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return DEFAULT_ACCENT;
  return h.toUpperCase();
}

// Serialises seeding so concurrent callers (multiple component mounts) don't each insert a copy.
let seedPromise: Promise<void> | null = null;

// Public path to the exact Acuren Word template that is filled on export.
export const ACUREN_BASE_DOCX_URL = '/photouploader/templates/acuren-r3.docx';

async function doSeed(): Promise<void> {
  // Fetch the logo + base .docx outside the transaction (network not allowed inside a Dexie tx).
  let logoBlob: Blob | null = null;
  try {
    const res = await fetch('/photouploader/acuren-logo.png');
    if (res?.ok) logoBlob = await res.blob();
  } catch {
    logoBlob = null;
  }
  let baseDocx: Blob | null = null;
  try {
    const res = await fetch(ACUREN_BASE_DOCX_URL);
    if (res?.ok) baseDocx = await res.blob();
  } catch {
    baseDocx = null;
  }
  // Atomic: re-check count inside the transaction, then clean up any duplicates/extra defaults.
  await db.transaction('rw', db.templates, async () => {
    const all = await db.templates.toArray();
    if (all.length === 0) {
      await db.templates.add({
        name: 'Acuren Standard',
        logoBlob,
        logoType: 'png',
        footerTagline: DEFAULT_TAGLINE,
        accentColor: DEFAULT_ACCENT,
        defaultLayout: 'three',
        isDefault: true,
        builtIn: true,
        baseDocx,
        createdAt: Date.now(),
      });
      return;
    }
    // Remove duplicate built-in seed templates left over from an earlier race.
    const builtIns = all.filter((t) => t?.builtIn).sort((a, b) => (a?.createdAt ?? 0) - (b?.createdAt ?? 0));
    for (let k = 1; k < builtIns.length; k++) {
      const dup = builtIns[k];
      if (dup?.id != null) await db.templates.delete(dup.id);
    }
    // Backfill the base .docx on an existing built-in from before this feature.
    const keepBuiltIn = builtIns[0];
    if (keepBuiltIn?.id != null && !keepBuiltIn.baseDocx && baseDocx) {
      await db.templates.update(keepBuiltIn.id, { baseDocx });
    }
    // Ensure exactly one default remains.
    const remaining = await db.templates.toArray();
    const defaults = remaining.filter((t) => t?.isDefault);
    if (defaults.length === 0 && remaining[0]?.id != null) {
      await db.templates.update(remaining[0].id, { isDefault: true });
    } else if (defaults.length > 1) {
      for (let k = 1; k < defaults.length; k++) {
        const d = defaults[k];
        if (d?.id != null) await db.templates.update(d.id, { isDefault: false });
      }
    }
  });
}

// Ensure the built-in Acuren template exists and a default is set. Returns the default template.
export async function ensureSeedTemplate(): Promise<TemplateRecord | undefined> {
  if (!seedPromise) seedPromise = doSeed().catch(() => {});
  await seedPromise;
  return getDefaultTemplate();
}

export async function getDefaultTemplate(): Promise<TemplateRecord | undefined> {
  const all = await db.templates.toArray();
  if (!all || all.length === 0) return undefined;
  return all.find((t) => t?.isDefault) ?? all[0];
}

export async function listTemplates(): Promise<TemplateRecord[]> {
  const all = await db.templates.orderBy('createdAt').toArray();
  return all ?? [];
}

export async function setDefaultTemplate(id: number): Promise<void> {
  const all = await db.templates.toArray();
  await Promise.all(
    (all ?? []).map((t) =>
      t?.id != null ? db.templates.update(t.id, { isDefault: t.id === id }) : Promise.resolve()
    )
  );
}

export async function deleteTemplate(id: number): Promise<void> {
  const target = await db.templates.get(id);
  await db.templates.delete(id);
  // If we removed the default, promote another template to default.
  if (target?.isDefault) {
    const remaining = await db.templates.toArray();
    if (remaining?.length && remaining[0]?.id != null) {
      await db.templates.update(remaining[0].id, { isDefault: true });
    }
  }
}

// Rasterise an SVG blob to a PNG blob via canvas (keeps the docx exporter happy).
async function svgToPng(svgBlob: Blob): Promise<{ blob: Blob; type: 'png' } | null> {
  try {
    const text = await svgBlob.text();
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
    const img = await loadImage(url);
    const w = img.naturalWidth || 600;
    const h = img.naturalHeight || 400;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) return null;
    return { blob: png, type: 'png' };
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function typeFromName(name: string): 'png' | 'jpg' {
  return /\.png$/i.test(name) ? 'png' : 'jpg';
}

// Extract a usable raster logo from an uploaded file.
// Accepts an image file directly, or a .docx/.odt (zip) from which the largest embedded raster image is pulled.
export async function extractLogoFromFile(
  file: File
): Promise<{ blob: Blob; type: 'png' | 'jpg' } | { error: string }> {
  const name = (file?.name ?? '').toLowerCase();
  const mime = (file?.type ?? '').toLowerCase();

  // Direct image upload.
  if (mime.startsWith('image/')) {
    if (mime.includes('svg') || name.endsWith('.svg')) {
      const png = await svgToPng(file);
      if (png) return png;
      return { error: 'Could not read that SVG. Please upload a PNG or JPG logo.' };
    }
    if (mime.includes('png') || mime.includes('jpeg') || mime.includes('jpg') || mime.includes('gif') || mime.includes('webp')) {
      return { blob: file, type: typeFromName(name) };
    }
    return { blob: file, type: 'png' };
  }

  // Document upload (.docx / .odt) — unzip and find the best embedded image.
  if (name.endsWith('.docx') || name.endsWith('.odt') || mime.includes('officedocument') || mime.includes('opendocument')) {
    try {
      const zip = await JSZip.loadAsync(file);
      const candidates: { path: string; size: number }[] = [];
      let svgCandidate: string | null = null;
      zip.forEach((path, entry) => {
        if (entry.dir) return;
        const p = path.toLowerCase();
        const inMedia = p.includes('media/') || p.includes('pictures/') || p.includes('word/media');
        if (!inMedia) return;
        if (/\.(png|jpe?g|gif)$/.test(p)) {
          // @ts-expect-error _data holds uncompressed size in jszip
          const size = entry?._data?.uncompressedSize ?? 0;
          candidates.push({ path, size });
        } else if (/\.svg$/.test(p) && !svgCandidate) {
          svgCandidate = path;
        }
      });
      candidates.sort((a, b) => b.size - a.size);
      if (candidates.length > 0) {
        const best = candidates[0]!;
        const blob = await zip.file(best.path)!.async('blob');
        return { blob, type: typeFromName(best.path) };
      }
      if (svgCandidate) {
        const svgBlob = await zip.file(svgCandidate)!.async('blob');
        const png = await svgToPng(svgBlob);
        if (png) return png;
      }
      return { error: 'No usable logo image was found in that document. Please upload a PNG or JPG logo instead.' };
    } catch {
      return { error: 'Could not read that document. Please upload a PNG or JPG logo instead.' };
    }
  }

  return { error: 'Unsupported file. Upload a PNG/JPG image, or a .docx/.odt template.' };
}
