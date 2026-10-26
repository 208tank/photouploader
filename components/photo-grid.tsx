'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PhotoRecord } from '@/lib/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  RotateCw, RotateCcw, Trash2, Replace, Pencil,
  GripVertical, ImageIcon
} from 'lucide-react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';

const AnnotationModal = dynamic(() => import('./annotation-modal').then(m => m.AnnotationModal), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="text-white">Loading annotation tools...</div></div>,
});

interface PhotoGridProps {
  photos: PhotoRecord[];
  onReorder: (newOrder: PhotoRecord[]) => void;
  onDelete: (id: number) => void;
  onRotate: (id: number, degrees: number) => void;
  onReplace: (id: number, file: File) => void;
  onUpdateDescription: (id: number, desc: string) => void;
  onSaveAnnotation: (id: number, blob: Blob) => void;
}

export function PhotoGrid({
  photos, onReorder, onDelete, onRotate, onReplace, onUpdateDescription, onSaveAnnotation
}: PhotoGridProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [annotatingPhoto, setAnnotatingPhoto] = useState<PhotoRecord | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState<number | null>(null);
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    const urls: Record<number, string> = {};
    for (const p of (photos ?? [])) {
      if (p?.id == null) continue;
      const blob = p?.annotatedBlob ?? p?.blob;
      if (blob) {
        urls[p.id] = URL.createObjectURL(blob);
      }
    }
    setThumbUrls(urls);
    return () => {
      Object.values(urls).forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
    };
  }, [photos]);

  const handleDragStart = (idx: number) => {
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx == null || dragIdx === idx) return;
    const reordered = [...(photos ?? [])];
    const [moved] = reordered.splice(dragIdx, 1);
    if (moved) reordered.splice(idx, 0, moved);
    setDragIdx(idx);
    onReorder(reordered);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
  };

  const handleReplaceClick = (id: number) => {
    setReplaceId(id);
    replaceInputRef?.current?.click?.();
  };

  const handleReplaceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e?.target?.files?.[0];
    if (file && replaceId != null) {
      onReplace(replaceId, file);
    }
    setReplaceId(null);
    if (replaceInputRef.current) replaceInputRef.current.value = '';
  };

  return (
    <>
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        onChange={handleReplaceFile}
        className="hidden"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(photos ?? []).map((photo: PhotoRecord, idx: number) => {
          const id = photo?.id ?? 0;
          const url = thumbUrls?.[id] ?? '';
          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.03 }}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e: any) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`cursor-grab active:cursor-grabbing ${
                dragIdx === idx ? 'opacity-50' : ''
              }`}
            >
              <Card className="overflow-hidden shadow-md hover:shadow-lg transition-shadow">
                {/* Image */}
                <div className="relative aspect-[4/3] bg-muted">
                  {url ? (
                    <img
                      src={url}
                      alt={photo?.description ?? 'Photo'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-10 h-10 text-muted-foreground" />
                    </div>
                  )}
                  {/* Order badge */}
                  <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow">
                    {photo?.order ?? idx + 1}
                  </div>
                  {/* Drag grip */}
                  <div className="absolute top-2 right-2 bg-black/40 text-white rounded p-1">
                    <GripVertical className="w-4 h-4" />
                  </div>
                </div>

                {/* Controls */}
                <div className="p-3">
                  <Input
                    value={photo?.description ?? ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdateDescription(id, e.target.value)}
                    placeholder="Photo description..."
                    className="text-sm mb-2 h-8"
                  />
                  <div className="flex items-center gap-1 flex-wrap">
                    <Button variant="ghost" size="icon-sm" onClick={() => onRotate(id, -90)} title="Rotate CCW">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => onRotate(id, 90)} title="Rotate CW">
                      <RotateCw className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setAnnotatingPhoto(photo)} title="Annotate">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => handleReplaceClick(id)} title="Replace">
                      <Replace className="w-3.5 h-3.5" />
                    </Button>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => { if (confirm('Delete this photo?')) onDelete(id); }}
                      className="text-destructive hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {annotatingPhoto && (
        <AnnotationModal
          photo={annotatingPhoto}
          onSave={(blob: Blob) => {
            if (annotatingPhoto?.id != null) onSaveAnnotation(annotatingPhoto.id, blob);
            setAnnotatingPhoto(null);
          }}
          onClose={() => setAnnotatingPhoto(null)}
        />
      )}
    </>
  );
}
