'use client';

import { useState, useEffect, useMemo } from 'react';
import type { PhotoRecord } from '@/lib/db';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, ArrowRight, Download, LayoutGrid, X, ChevronLeft, ChevronRight
} from 'lucide-react';
import { motion } from 'framer-motion';

interface PreviewBranding {
  logoUrl: string | null;
  footerTagline: string;
  accentColor: string; // hex without '#'
}

interface PreviewFields {
  clientName: string;
  inspectionTitle: string;
  appendixLabel: string;
  projectReference: string;
}

interface PreviewPanelProps {
  photos: PhotoRecord[];
  layoutMode: 'three' | 'two' | 'optimize';
  onChangeLayout: (mode: 'three' | 'two' | 'optimize') => void;
  onClose: () => void;
  onExport: () => void;
  exporting: boolean;
  sessionName: string;
  branding: PreviewBranding;
  fields: PreviewFields;
  includeToc?: boolean;
}

interface PageGroup {
  photos: PhotoRecord[];
  startIndex: number;
}

export function PreviewPanel({
  photos, layoutMode, onChangeLayout, onClose, onExport, exporting, sessionName, branding, fields, includeToc
}: PreviewPanelProps) {
  const accent = '#' + (branding?.accentColor || '0A2A5E');
  const [currentPage, setCurrentPage] = useState(0);
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    const urls: Record<number, string> = {};
    for (const p of (photos ?? [])) {
      if (p?.id == null) continue;
      const blob = p?.annotatedBlob ?? p?.blob;
      if (blob) urls[p.id] = URL.createObjectURL(blob);
    }
    setThumbUrls(urls);
    return () => Object.values(urls).forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
  }, [photos]);

  const pages = useMemo(() => {
    const sorted = [...(photos ?? [])].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
    const result: PageGroup[] = [];

    const isLandscape = (photo: PhotoRecord): boolean => {
      const w = photo?.width ?? 0;
      const h = photo?.height ?? 0;
      if (w > 0 && h > 0) return w > h;
      return true; // unknown dimensions: assume landscape
    };

    // Match the export grouping: optimize fits 3/page only when the next three are ALL
    // landscape, otherwise 2/page (at least one portrait). three/two are fixed.
    const pageSizeAt = (i: number): number => {
      if (layoutMode === 'two') return 2;
      if (layoutMode === 'three') return 3;
      const remaining = sorted.length - i;
      if (remaining >= 3 && isLandscape(sorted[i]) && isLandscape(sorted[i + 1]) && isLandscape(sorted[i + 2])) {
        return 3;
      }
      return 2;
    };

    let i = 0;
    while (i < sorted.length) {
      const perPage = pageSizeAt(i);
      const group = sorted.slice(i, i + perPage);
      result.push({ photos: group, startIndex: i });
      i += group.length;
    }

    return result;
  }, [photos, layoutMode]);

  const hasToc = (includeToc ?? false) && (pages?.length ?? 0) > 0;

  // TOC entries: each image with the physical page it lands on (TOC itself is page 1).
  const tocEntries = useMemo(() => {
    if (!hasToc) return [] as { label: string; page: number }[];
    const entries: { label: string; page: number }[] = [];
    let imageNo = 1;
    (pages ?? []).forEach((grp, idx) => {
      const pageNum = idx + 2;
      (grp?.photos ?? []).forEach((photo) => {
        const desc = photo?.description?.trim();
        entries.push({ label: `Image ${imageNo}` + (desc ? ` – ${desc}` : ''), page: pageNum });
        imageNo++;
      });
    });
    return entries;
  }, [pages, hasToc]);

  const totalPages = (pages?.length ?? 0) + (hasToc ? 1 : 0);
  const isTocPage = hasToc && currentPage === 0;
  const photoPageIndex = hasToc ? currentPage - 1 : currentPage;
  const page = isTocPage ? undefined : pages?.[photoPageIndex];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-primary text-primary-foreground shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-primary-foreground hover:bg-white/15"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-base font-display font-bold">Preview: {sessionName}</h1>
              <p className="text-xs opacity-75">Page {currentPage + 1} of {totalPages || 1}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 mr-2">
              {(['three', 'two', 'optimize'] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={layoutMode === mode ? 'secondary' : 'ghost'}
                  size="xs"
                  onClick={() => { onChangeLayout(mode); setCurrentPage(0); }}
                  className={layoutMode === mode ? '' : 'text-primary-foreground hover:bg-white/15'}
                >
                  {mode === 'three' ? '3/pg' : mode === 'two' ? '2/pg' : 'Auto'}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              onClick={onExport}
              loading={exporting}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Page preview */}
        <motion.div
          key={currentPage}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white rounded-lg shadow-lg border mx-auto flex flex-col"
          style={{ maxWidth: 680, aspectRatio: '8.5/11', padding: '34px 40px 20px' }}
        >
          {/* Letterhead */}
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt="Logo" className="h-14 w-auto object-contain mb-1" />
          ) : (
            <p className="text-2xl font-extrabold mb-1" style={{ color: accent }}>ACUREN</p>
          )}
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              {fields?.clientName?.trim() && (
                <p className="text-[11px] font-bold text-gray-900 leading-tight">{fields.clientName}</p>
              )}
              {fields?.inspectionTitle?.trim() && (
                <p className="text-[10px] text-gray-700 leading-tight">{fields.inspectionTitle}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              {fields?.appendixLabel?.trim() && (
                <p className="text-[11px] font-bold italic text-gray-900">{fields.appendixLabel}</p>
              )}
              <p className="text-[10px] text-gray-700">Page {currentPage + 1} of {totalPages || 1}</p>
            </div>
          </div>
          <div className="border-b-2 mb-3 mt-1" style={{ borderColor: accent }} />

          {/* Table of contents page (optional) */}
          {isTocPage ? (
            <div className="flex flex-col flex-1 min-h-0">
              <p className="text-center text-sm font-bold text-gray-900 mb-4">Table of Contents</p>
              <div className="flex flex-col gap-1.5">
                {tocEntries.map((e, idx) => (
                  <div key={idx} className="flex items-end gap-1 text-[11px] text-gray-800">
                    <span className="shrink-0">{e.label}</span>
                    <span className="flex-1 border-b border-dotted border-gray-400 mb-[3px]" />
                    <span className="shrink-0">{e.page}</span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-400 italic mt-4">
                This is an updatable Word table of contents. Open the exported file in Word and choose “Update Field” if the page numbers need refreshing.
              </p>
            </div>
          ) : (
          /* Photo rows: caption left, image right */
          <div className="flex flex-col gap-4 flex-1 min-h-0">
            {(page?.photos ?? []).map((photo: PhotoRecord, idx: number) => {
              const id = photo?.id ?? 0;
              const url = thumbUrls?.[id] ?? '';
              const perPage = page?.photos?.length ?? 3;
              const imageNo = (page?.startIndex ?? 0) + idx + 1;
              const maxH = perPage <= 2 ? 240 : 170;
              return (
                <div key={id} className="flex items-center gap-4">
                  <div className="shrink-0" style={{ width: 110 }}>
                    <p className="text-[11px] font-bold text-gray-900">Image {imageNo}</p>
                    <p className="text-[11px] text-gray-700 break-words">
                      {photo?.description?.trim() || `Photo ${imageNo}`}
                    </p>
                  </div>
                  <div
                    className="flex-1 flex items-center justify-center bg-gray-50 rounded overflow-hidden"
                    style={{ maxHeight: maxH }}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={photo?.description ?? 'Photo'}
                        className="max-w-full object-contain"
                        style={{ maxHeight: maxH }}
                      />
                    ) : (
                      <div className="text-gray-300 text-sm py-10">No image</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {/* Simulated footer */}
          <div className="pt-2 mt-2 border-t">
            <p className="text-[9px] leading-tight">
              <span className="font-bold" style={{ color: accent }}>{branding?.footerTagline || ''}</span>
              {fields?.projectReference?.trim() && (
                <span className="text-gray-400">&nbsp;&nbsp;{fields.projectReference}</span>
              )}
            </p>
          </div>
        </motion.div>

        {/* Page navigation */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              {currentPage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
            >
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
