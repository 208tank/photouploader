'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { db, type SessionRecord } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Camera, Plus, Trash2, FolderOpen, Clock, FileText, ChevronRight, Wifi, WifiOff, LayoutTemplate, Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { TemplateManager } from '@/components/template-manager';
import { SettingsModal } from '@/components/settings-modal';
import { ensureSeedTemplate, getDefaultTemplate } from '@/lib/templates';

export function SessionManager() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [photoCounts, setPhotoCounts] = useState<Record<number, number>>({});
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const all = await db.sessions.orderBy('updatedAt').reverse().toArray();
      setSessions(all ?? []);
      const counts: Record<number, number> = {};
      for (const s of (all ?? [])) {
        if (s?.id != null) {
          counts[s.id] = await db.photos.where('sessionId').equals(s.id).count();
        }
      }
      setPhotoCounts(counts);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    ensureSeedTemplate().catch(() => {});
    setIsOnline(navigator?.onLine ?? true);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [loadSessions]);

  const createSession = async () => {
    const name = newName.trim();
    if (!name) { toast.error('Please enter a session name'); return; }
    try {
      const now = Date.now();
      const def = await getDefaultTemplate();
      const id = await db.sessions.add({
        name,
        layoutMode: def?.defaultLayout ?? 'three',
        templateId: def?.id,
        createdAt: now,
        updatedAt: now,
      });
      setNewName('');
      setShowCreate(false);
      router.push(`/session?id=${id}`);
    } catch {
      toast.error('Failed to create session');
    }
  };

  const deleteSession = async (id: number | undefined) => {
    if (id == null) return;
    if (!confirm('Delete this session and all its photos?')) return;
    try {
      await db.photos.where('sessionId').equals(id).delete();
      await db.sessions.delete(id);
      await loadSessions();
      toast.success('Session deleted');
    } catch {
      toast.error('Failed to delete session');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-primary text-primary-foreground">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center">
              <Camera className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold tracking-tight">Inspector Photo Report</h1>
              <p className="text-xs opacity-75">Organize · Annotate · Export</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTemplates(true)}
              className="text-primary-foreground hover:bg-white/15"
            >
              <LayoutTemplate className="w-4 h-4" />
              <span className="hidden sm:inline">Templates</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(true)}
              className="text-primary-foreground hover:bg-white/15"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
            {isOnline ? (
              <span className="flex items-center gap-1 text-xs opacity-75"><Wifi className="w-3.5 h-3.5" /> Online</span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-orange-300"><WifiOff className="w-3.5 h-3.5" /> Offline</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Welcome section */}
        <div className="mb-8">
          <h2 className="text-2xl font-display font-bold tracking-tight mb-1">Report Sessions</h2>
          <p className="text-muted-foreground">Create and manage your inspection photo reports. All data is saved locally on this device.</p>
        </div>

        {/* Create new session */}
        <div className="mb-6">
          {!showCreate ? (
            <Button
              onClick={() => setShowCreate(true)}
              className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-md"
              size="lg"
            >
              <Plus className="w-5 h-5" />
              New Report Session
            </Button>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className="p-4 shadow-md">
                <p className="text-sm font-medium mb-2">Session Name / Job Number</p>
                <div className="flex gap-2">
                  <Input
                    value={newName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                    placeholder="e.g. Tank Farm #4 — Oct 2026"
                    onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && createSession()}
                    autoFocus
                    className="flex-1"
                  />
                  <Button onClick={createSession}>Create</Button>
                  <Button variant="ghost" onClick={() => { setShowCreate(false); setNewName(''); }}>Cancel</Button>
                </div>
              </Card>
            </motion.div>
          )}
        </div>

        {/* Session list */}
        {(sessions?.length ?? 0) === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <FileText className="w-10 h-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-1">No sessions yet</h3>
            <p className="text-muted-foreground text-sm">Create your first report session to get started.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            <AnimatePresence>
              {(sessions ?? []).map((session: SessionRecord, idx: number) => (
                <motion.div
                  key={session?.id ?? idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -50 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card
                    className="p-4 hover:shadow-lg transition-shadow cursor-pointer group"
                    onClick={() => session?.id != null && router.push(`/session?id=${session.id}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <FolderOpen className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-medium text-base">{session?.name ?? 'Untitled'}</h3>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <Camera className="w-3 h-3" />
                              {photoCounts?.[session?.id ?? 0] ?? 0} photos
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(session?.updatedAt ?? 0).toLocaleDateString('en-US', { timeZone: 'UTC' })}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            deleteSession(session?.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {showTemplates && (
        <TemplateManager
          onClose={() => setShowTemplates(false)}
          onChanged={loadSessions}
        />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
