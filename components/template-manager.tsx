'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { db, type TemplateRecord } from '@/lib/db';
import {
  listTemplates, setDefaultTemplate, deleteTemplate, extractLogoFromFile,
  ensureSeedTemplate, normalizeHex, DEFAULT_TAGLINE, DEFAULT_ACCENT,
} from '@/lib/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  X, Plus, Trash2, Star, Check, Upload, Image as ImageIcon, Loader2, LayoutTemplate, Download, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { ACUREN_BASE_DOCX_URL } from '@/lib/templates';
import { getSavedDir, saveReportBlob } from '@/lib/save-file';

interface TemplateManagerProps {
  onClose: () => void;
  onChanged?: () => void;
}

type LogoPreview = { blob: Blob; type: 'png' | 'jpg'; url: string } | null;

export function TemplateManager({ onClose, onChanged }: TemplateManagerProps) {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [logoUrls, setLogoUrls] = useState<Record<number, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // form state
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState(DEFAULT_TAGLINE);
  const [accent, setAccent] = useState('#' + DEFAULT_ACCENT);
  const [layout, setLayout] = useState<'three' | 'two' | 'optimize'>('three');
  const [logo, setLogo] = useState<LogoPreview>(null);
  const [baseDocxFile, setBaseDocxFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    await ensureSeedTemplate();
    const all = await listTemplates();
    setTemplates(all);
    const urls: Record<number, string> = {};
    for (const t of all) {
      if (t?.id != null && t.logoBlob) urls[t.id] = URL.createObjectURL(t.logoBlob);
    }
    setLogoUrls((prev) => {
      Object.values(prev).forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
      return urls;
    });
  }, []);

  useEffect(() => {
    load();
    return () => {
      setLogoUrls((prev) => { Object.values(prev).forEach((u) => { try { URL.revokeObjectURL(u); } catch {} }); return {}; });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setName(''); setTagline(DEFAULT_TAGLINE); setAccent('#' + DEFAULT_ACCENT);
    setLayout('three');
    if (logo?.url) { try { URL.revokeObjectURL(logo.url); } catch {} }
    setLogo(null);
    setBaseDocxFile(null);
  };

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const res = await fetch(ACUREN_BASE_DOCX_URL);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const dir = await getSavedDir();
      const method = await saveReportBlob(blob, 'Acuren_Photo_Report_Template.docx', dir);
      toast.success(method === 'folder' ? 'Template saved to your chosen folder' : 'Template downloaded');
    } catch {
      toast.error('Could not download the template');
    } finally {
      setDownloading(false);
    }
  };

  const handleLogoFile = async (file: File | undefined) => {
    if (!file) return;
    setExtracting(true);
    try {
      const result = await extractLogoFromFile(file);
      if ('error' in result) { toast.error(result.error); return; }
      if (logo?.url) { try { URL.revokeObjectURL(logo.url); } catch {} }
      setLogo({ blob: result.blob, type: result.type, url: URL.createObjectURL(result.blob) });
      // A real .docx is kept verbatim so exports match its exact letterhead, fonts and margins.
      const isDocx = /\.docx$/i.test(file.name) || (file.type ?? '').includes('officedocument.wordprocessing');
      setBaseDocxFile(isDocx ? file : null);
      if (!name.trim() && !/\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)) {
        setName(file.name.replace(/\.(docx|odt)$/i, ''));
      }
      toast.success(isDocx ? 'Template loaded (exact formatting will be preserved)' : 'Logo loaded');
    } catch {
      toast.error('Could not read that file');
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveTemplate = async () => {
    if (!name.trim()) { toast.error('Enter a template name'); return; }
    setSaving(true);
    try {
      const existingCount = await db.templates.count();
      await db.templates.add({
        name: name.trim(),
        logoBlob: logo?.blob ?? null,
        logoType: logo?.type ?? 'png',
        footerTagline: tagline.trim(),
        accentColor: normalizeHex(accent),
        defaultLayout: layout,
        isDefault: existingCount === 0,
        builtIn: false,
        baseDocx: baseDocxFile ?? null,
        createdAt: Date.now(),
      });
      toast.success('Template added');
      resetForm();
      setShowForm(false);
      await load();
      onChanged?.();
    } catch {
      toast.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const makeDefault = async (id: number | undefined) => {
    if (id == null) return;
    await setDefaultTemplate(id);
    await load();
    onChanged?.();
    toast.success('Default template set');
  };

  const remove = async (id: number | undefined) => {
    if (id == null) return;
    if ((templates?.length ?? 0) <= 1) { toast.error('At least one template is required'); return; }
    if (!confirm('Delete this template?')) return;
    await deleteTemplate(id);
    await load();
    onChanged?.();
    toast.success('Template deleted');
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-2xl my-8 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-bold">Report Templates</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            Templates control the letterhead branding (logo, tagline and accent colour) and the default photo layout.
            Set one as the default and it will be applied to every new report.
          </p>

          <div className="rounded-lg border bg-muted/30 p-3 flex items-start gap-3">
            <FileText className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Start from the standard template</p>
              <p className="text-xs text-muted-foreground">
                Download the fully-formatted Word template, adjust it to your branding, then upload it back below
                — exports will match your edited file exactly.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate} loading={downloading} className="shrink-0">
              <Download className="w-4 h-4" /> Download
            </Button>
          </div>

          {/* Template list */}
          <div className="grid gap-2">
            {(templates ?? []).map((t) => (
              <div key={t.id} className="flex items-center gap-3 border rounded-lg p-3">
                <div className="w-16 h-12 bg-gray-50 rounded flex items-center justify-center overflow-hidden shrink-0 border">
                  {t.id != null && logoUrls[t.id] ? (
                    <img src={logoUrls[t.id]} alt={t.name} className="max-w-full max-h-full object-contain" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{t.name}</p>
                    {t.isDefault && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent/15 text-accent flex items-center gap-1">
                        <Star className="w-3 h-3 fill-current" /> Default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {t.footerTagline || 'No tagline'} · {t.defaultLayout === 'three' ? '3/page' : t.defaultLayout === 'two' ? '2/page' : 'Optimize'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="w-5 h-5 rounded-full border" style={{ backgroundColor: '#' + t.accentColor }} title={'#' + t.accentColor} />
                  {!t.isDefault && (
                    <Button variant="ghost" size="xs" onClick={() => makeDefault(t.id)} title="Set as default">
                      <Star className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="icon-sm"
                    onClick={() => remove(t.id)}
                    className="text-destructive hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Add form */}
          {!showForm ? (
            <Button variant="outline" onClick={() => setShowForm(true)} className="w-full">
              <Plus className="w-4 h-4" /> Add Template
            </Button>
          ) : (
            <Card className="p-4 space-y-3 bg-muted/30">
              <div>
                <label className="text-xs font-medium">Template Name</label>
                <Input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="e.g. Acme NDT Standard" />
              </div>

              <div>
                <label className="text-xs font-medium">Logo</label>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-14 bg-white rounded flex items-center justify-center overflow-hidden border shrink-0">
                    {logo?.url ? (
                      <img src={logo.url} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-gray-300" />
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={extracting}>
                    <Upload className="w-4 h-4" /> Upload Logo / Template
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,.docx,.odt"
                    className="hidden"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleLogoFile(e.target.files?.[0])}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Upload a PNG/JPG logo, or a .docx/.odt template file — the logo will be pulled from it automatically.
                </p>
                {baseDocxFile && (
                  <p className="text-[11px] text-accent mt-1 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Exact Word formatting will be preserved from “{baseDocxFile.name}”.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Footer Tagline</label>
                  <Input value={tagline} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTagline(e.target.value)} placeholder="A Higher Level of Reliability" />
                </div>
                <div>
                  <label className="text-xs font-medium">Accent Colour</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#0A2A5E'} onChange={(e) => setAccent(e.target.value)} className="w-10 h-9 rounded border cursor-pointer p-0.5" />
                    <Input value={accent} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAccent(e.target.value)} className="flex-1" />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">Default Layout</label>
                <div className="flex items-center gap-2 mt-1">
                  {(['three', 'two', 'optimize'] as const).map((m) => (
                    <Button key={m} variant={layout === m ? 'default' : 'outline'} size="xs" onClick={() => setLayout(m)}>
                      {m === 'three' ? '3/page' : m === 'two' ? '2/page' : 'Optimize'}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={saveTemplate} loading={saving}><Check className="w-4 h-4" /> Save Template</Button>
                <Button variant="ghost" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
              </div>
            </Card>
          )}
        </div>
      </Card>
    </div>
  );
}
