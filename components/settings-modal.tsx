'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { X, FolderOpen, Settings as SettingsIcon, Download, HardDrive, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  isFsAccessSupported, getSavedDirName, pickSaveDir, clearSavedDir,
} from '@/lib/save-file';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [supported] = useState(isFsAccessSupported());
  const [dirName, setDirName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setDirName(await getSavedDirName());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const choose = async () => {
    setBusy(true);
    try {
      const res = await pickSaveDir();
      if (res) {
        await refresh();
        toast.success(`Reports will be saved to “${res.name}”`);
      }
    } catch {
      toast.error('Could not open the folder picker');
    } finally {
      setBusy(false);
    }
  };

  const useDownloads = async () => {
    setBusy(true);
    try {
      await clearSavedDir();
      await refresh();
      toast.success('Reports will be saved to your browser downloads');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-lg my-8 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-display font-bold">Settings</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-primary" /> Save location for reports &amp; templates
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Choose a folder where exported Word reports and downloaded templates are written directly.
              When no folder is chosen, they go to your browser&apos;s downloads folder.
            </p>
          </div>

          <div className="rounded-lg border p-3 bg-muted/30">
            <p className="text-xs text-muted-foreground">Current save location</p>
            <p className="font-medium flex items-center gap-2 mt-0.5">
              {dirName ? (
                <><FolderOpen className="w-4 h-4 text-accent" /> {dirName}</>
              ) : (
                <><Download className="w-4 h-4 text-muted-foreground" /> Browser downloads (default)</>
              )}
            </p>
          </div>

          {supported ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={choose} loading={busy}>
                <FolderOpen className="w-4 h-4" /> Choose folder…
              </Button>
              {dirName && (
                <Button variant="outline" onClick={useDownloads} disabled={busy}>
                  <Download className="w-4 h-4" /> Use browser downloads
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Choosing a folder isn&apos;t supported in this browser, so reports will be saved to your
                downloads folder. For folder selection, open the app in Chrome or Edge on desktop.
              </span>
            </div>
          )}

          <div className="rounded-lg border p-3 text-xs text-muted-foreground flex gap-2">
            <HardDrive className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Your sessions and photos are always stored on this device so the app keeps working offline.
              This setting only controls where <strong>exported</strong> Word reports and downloaded templates
              are saved.
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
