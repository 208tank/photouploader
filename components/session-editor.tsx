'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { db, type PhotoRecord, type SessionRecord, type TemplateRecord } from '@/lib/db';
import { parseFilename, getImageDimensions } from '@/lib/filename-parser';
import { rotateImage } from '@/lib/image-utils';
import { exportToDocx, type ReportBranding, type ReportFields } from '@/lib/export-docx';
import { fillDocxAndSave } from '@/lib/fill-docx';
import { getSavedDir } from '@/lib/save-file';
import { ensureSeedTemplate, listTemplates, getDefaultTemplate, DEFAULT_TAGLINE, DEFAULT_ACCENT } from '@/lib/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { PhotoGrid } from '@/components/photo-grid';
import { PreviewPanel } from '@/components/preview-panel';
import { toast } from 'sonner';
import {
  ArrowLeft, Upload, Download, Eye, LayoutGrid,
  Camera, Save, Loader2, FileText
} from 'lucide-react';

interface SessionEditorProps {
  sessionId: number;
}

export function SessionEditor({ sessionId }: SessionEditorProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'three' | 'two' | 'optimize'>('three');
  const [includeToc, setIncludeToc] = useState(false);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<TemplateRecord | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<ReportFields>({
    clientName: '', inspectionTitle: '', appendixLabel: '', projectReference: '',
  });

  const loadData = useCallback(async () => {
    try {
      await ensureSeedTemplate();
      const s = await db.sessions.get(sessionId);
      if (!s) { router.push('/'); return; }
      setSession(s);
      setLayoutMode(s?.layoutMode ?? 'three');
      setIncludeToc(s?.includeToc ?? false);
      setFields({
        clientName: s?.clientName ?? '',
        inspectionTitle: s?.inspectionTitle ?? '',
        appendixLabel: s?.appendixLabel ?? '',
        projectReference: s?.projectReference ?? '',
      });
      const all = await listTemplates();
      setTemplates(all);
      let tmpl: TemplateRecord | null = null;
      if (s?.templateId != null) tmpl = all.find((t) => t?.id === s.templateId) ?? null;
      if (!tmpl) tmpl = (await getDefaultTemplate()) ?? null;
      setActiveTemplate(tmpl);
      const p = await db.photos.where('sessionId').equals(sessionId).sortBy('order');
      setPhotos(p ?? []);
    } catch {
      toast.error('Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [sessionId, router]);

  useEffect(() => { loadData(); }, [loadData]);

  // Build/revoke the preview logo object URL whenever the active template changes.
  useEffect(() => {
    const blob = activeTemplate?.logoBlob;
    if (!blob) { setLogoUrl(null); return; }
    const url = URL.createObjectURL(blob);
    setLogoUrl(url);
    return () => { try { URL.revokeObjectURL(url); } catch {} };
  }, [activeTemplate]);

  const updateField = (key: keyof ReportFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    db.sessions.update(sessionId, { [key]: value, updatedAt: Date.now() }).catch(() => {});
  };

  const selectTemplate = async (templateId: number) => {
    const tmpl = templates.find((t) => t?.id === templateId) ?? null;
    setActiveTemplate(tmpl);
    try {
      await db.sessions.update(sessionId, { templateId, updatedAt: Date.now() });
    } catch { /* ignore */ }
  };

  const handleFileDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e?.dataTransfer?.files ?? []).filter((f: File) => f?.type?.startsWith('image/'));
    if (files.length === 0) return;
    await importFiles(files);
  }, [sessionId, photos]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e?.target?.files ?? []).filter((f: File) => f?.type?.startsWith('image/'));
    if (files.length === 0) return;
    await importFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [sessionId, photos]);

  const importFiles = async (files: File[]) => {
    setImporting(true);
    try {
      const currentMax = (photos ?? []).reduce((max: number, p: PhotoRecord) => Math.max(max, p?.order ?? 0), 0);
      const parsed = files.map((f: File) => ({ file: f, ...parseFilename(f?.name ?? '') }));
      parsed.sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));

      const newPhotos: PhotoRecord[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (!item) continue;
        const blob = item.file as Blob;
        const dims = await getImageDimensions(blob);
        const record: PhotoRecord = {
          sessionId,
          order: (item.order > 0 ? item.order : currentMax + i + 1),
          fileName: item.original,
          description: item.description,
          blob,
          annotatedBlob: null,
          rotation: 0,
          width: dims?.width ?? 800,
          height: dims?.height ?? 600,
          createdAt: Date.now(),
        };
        const id = await db.photos.add(record);
        record.id = id as number;
        newPhotos.push(record);
      }

      await db.sessions.update(sessionId, { updatedAt: Date.now() });
      await loadData();
      toast.success(`Imported ${newPhotos.length} photo(s)`);
    } catch (err: any) {
      toast.error('Failed to import photos');
    } finally {
      setImporting(false);
    }
  };

  const updatePhoto = async (id: number, updates: Partial<PhotoRecord>) => {
    try {
      await db.photos.update(id, updates);
      await db.sessions.update(sessionId, { updatedAt: Date.now() });
      await loadData();
    } catch {
      toast.error('Failed to update photo');
    }
  };

  const deletePhoto = async (id: number) => {
    try {
      await db.photos.delete(id);
      await db.sessions.update(sessionId, { updatedAt: Date.now() });
      await loadData();
      toast.success('Photo deleted');
    } catch {
      toast.error('Failed to delete photo');
    }
  };

  const rotatePhoto = async (id: number, degrees: number) => {
    const photo = photos.find((p: PhotoRecord) => p?.id === id);
    if (!photo?.blob) return;
    try {
      const rotated = await rotateImage(photo.blob, degrees);
      const dims = await getImageDimensions(rotated);
      await updatePhoto(id, {
        blob: rotated,
        rotation: ((photo?.rotation ?? 0) + degrees) % 360,
        width: dims?.width ?? photo.width,
        height: dims?.height ?? photo.height,
        annotatedBlob: null,
      });
    } catch {
      toast.error('Failed to rotate');
    }
  };

  const replacePhoto = async (id: number, file: File) => {
    try {
      const dims = await getImageDimensions(file);
      await updatePhoto(id, {
        blob: file,
        annotatedBlob: null,
        rotation: 0,
        width: dims?.width ?? 800,
        height: dims?.height ?? 600,
        fileName: file.name,
      });
      toast.success('Photo replaced');
    } catch {
      toast.error('Failed to replace');
    }
  };

  const reorderPhotos = async (newOrder: PhotoRecord[]) => {
    try {
      for (let i = 0; i < (newOrder?.length ?? 0); i++) {
        const p = newOrder[i];
        if (p?.id != null) {
          await db.photos.update(p.id, { order: i + 1 });
        }
      }
      await db.sessions.update(sessionId, { updatedAt: Date.now() });
      await loadData();
    } catch {
      toast.error('Failed to reorder');
    }
  };

  const buildBranding = async (): Promise<ReportBranding> => {
    const tmpl = activeTemplate;
    let logoBuffer: ArrayBuffer | null = null;
    if (tmpl?.logoBlob) {
      try { logoBuffer = await tmpl.logoBlob.arrayBuffer(); } catch { logoBuffer = null; }
    }
    return {
      logoBuffer,
      logoType: tmpl?.logoType ?? 'png',
      footerTagline: tmpl?.footerTagline ?? DEFAULT_TAGLINE,
      accentColor: tmpl?.accentColor ?? DEFAULT_ACCENT,
    };
  };

  const handleExport = async () => {
    if ((photos?.length ?? 0) === 0) { toast.error('No photos to export'); return; }
    setExporting(true);
    try {
      const saveDir = await getSavedDir();
      let method: 'folder' | 'download';
      if (activeTemplate?.baseDocx) {
        // Faithful path: fill the exact uploaded .docx template (real letterhead, logo, fonts).
        method = await fillDocxAndSave(activeTemplate.baseDocx, {
          sessionName: session?.name ?? 'Report',
          photos,
          layoutMode,
          fields,
          footerTagline: activeTemplate.footerTagline,
          includeToc,
          saveDir,
        });
      } else {
        // Fallback: code-generated report from logo-only custom templates.
        const branding = await buildBranding();
        method = await exportToDocx({
          sessionName: session?.name ?? 'Report',
          photos,
          layoutMode,
          branding,
          fields,
          includeToc,
          saveDir,
        });
      }
      toast.success(method === 'folder' ? 'Report saved to your chosen folder' : 'Word document downloaded!');
    } catch (err: any) {
      console.error(err);
      toast.error('Export failed: ' + (err?.message ?? 'Unknown error'));
    } finally {
      setExporting(false);
    }
  };

  const toggleToc = async (value: boolean) => {
    setIncludeToc(value);
    try {
      await db.sessions.update(sessionId, { includeToc: value, updatedAt: Date.now() });
    } catch { /* ignore */ }
  };

  const changeLayout = async (mode: 'three' | 'two' | 'optimize') => {
    setLayoutMode(mode);
    try {
      await db.sessions.update(sessionId, { layoutMode: mode, updatedAt: Date.now() });
    } catch { /* ignore */ }
  };

  const saveAnnotation = async (photoId: number, annotatedBlob: Blob) => {
    try {
      const dims = await getImageDimensions(annotatedBlob);
      await updatePhoto(photoId, {
        annotatedBlob,
        width: dims?.width ?? 800,
        height: dims?.height ?? 600,
      });
      toast.success('Annotation saved');
    } catch {
      toast.error('Failed to save annotation');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (showPreview) {
    return (
      <PreviewPanel
        photos={photos}
        layoutMode={layoutMode}
        onChangeLayout={changeLayout}
        onClose={() => setShowPreview(false)}
        onExport={handleExport}
        exporting={exporting}
        sessionName={session?.name ?? 'Report'}
        branding={{
          logoUrl,
          footerTagline: activeTemplate?.footerTagline ?? DEFAULT_TAGLINE,
          accentColor: activeTemplate?.accentColor ?? DEFAULT_ACCENT,
        }}
        fields={fields}
        includeToc={includeToc}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-primary text-primary-foreground shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => router.push('/')}
              className="text-primary-foreground hover:bg-white/15"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-base font-display font-bold tracking-tight truncate max-w-[200px] sm:max-w-none">
                {session?.name ?? 'Session'}
              </h1>
              <p className="text-xs opacity-75">{photos?.length ?? 0} photos</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPreview(true)}
              className="text-primary-foreground hover:bg-white/15"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">Preview</span>
            </Button>
            <Button
              size="sm"
              onClick={handleExport}
              loading={exporting}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Layout mode selector */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Layout:</span>
            {(['three', 'two', 'optimize'] as const).map((mode) => (
              <Button
                key={mode}
                variant={layoutMode === mode ? 'default' : 'outline'}
                size="xs"
                onClick={() => changeLayout(mode)}
              >
                {mode === 'three' ? '3/page' : mode === 'two' ? '2/page' : 'Optimize'}
              </Button>
            ))}
          </div>
          <Button
            onClick={() => fileInputRef?.current?.click?.()}
            loading={importing}
            variant="outline"
            size="sm"
          >
            <Upload className="w-4 h-4" />
            Add Photos
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Report details & template */}
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium">Report Details</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Template</label>
              <select
                value={activeTemplate?.id ?? ''}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) selectTemplate(v);
                }}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {templates.length === 0 && <option value="">Loading…</option>}
                {templates.map((t) => (
                  <option key={t?.id ?? 0} value={t?.id ?? 0}>
                    {t?.name ?? 'Untitled'}{t?.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Client Name</label>
              <Input
                value={fields.clientName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('clientName', e.target.value)}
                placeholder="e.g. Calgary Fuel Facilities Corporation"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Inspection Title</label>
              <Input
                value={fields.inspectionTitle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('inspectionTitle', e.target.value)}
                placeholder="e.g. Tank 4 – Out-of-Service Inspection"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Appendix Label</label>
              <Input
                value={fields.appendixLabel}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('appendixLabel', e.target.value)}
                placeholder="e.g. Appendix D"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Project Reference</label>
              <Input
                value={fields.projectReference}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('projectReference', e.target.value)}
                placeholder="e.g. 208-J300295-61 …"
              />
            </div>
          </div>
          <label className="mt-4 flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeToc}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleToc(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
            />
            <span>
              <span className="text-sm font-medium block">Include table of contents</span>
              <span className="text-xs text-muted-foreground block">
                Adds an updatable Word table of contents on the first page, listing each image with its page number. Open in Word and choose “Update Field” if the page numbers aren’t filled in automatically.
              </span>
            </span>
          </label>
        </Card>

        {/* Drop zone or photo grid */}
        {(photos?.length ?? 0) === 0 ? (
          <div
            className="border-2 border-dashed border-border rounded-xl p-16 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            onDragOver={(e: React.DragEvent) => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef?.current?.click?.()}
          >
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Camera className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-1">Drop photos here</h3>
            <p className="text-muted-foreground text-sm mb-4">
              or click to browse. Photos with numbered filenames (e.g. "001 - Tank Overview.jpg") will be auto-ordered and labeled.
            </p>
            <Button variant="outline">
              <Upload className="w-4 h-4" />
              Select Photos
            </Button>
          </div>
        ) : (
          <div
            onDragOver={(e: React.DragEvent) => { e.preventDefault(); }}
            onDrop={handleFileDrop}
          >
            <PhotoGrid
              photos={photos}
              onReorder={reorderPhotos}
              onDelete={deletePhoto}
              onRotate={rotatePhoto}
              onReplace={replacePhoto}
              onUpdateDescription={(id: number, desc: string) => updatePhoto(id, { description: desc })}
              onSaveAnnotation={saveAnnotation}
            />
          </div>
        )}
      </main>
    </div>
  );
}
