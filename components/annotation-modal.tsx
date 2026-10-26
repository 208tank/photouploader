'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PhotoRecord } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  X, MoveRight, Circle, Square, Undo2, Trash2, Save,
  Minus
} from 'lucide-react';

type ToolType = 'arrow' | 'circle' | 'rectangle';

interface AnnotationModalProps {
  photo: PhotoRecord;
  onSave: (blob: Blob) => void;
  onClose: () => void;
}

interface AnnotationObject {
  type: ToolType;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  lineWidth: number;
  dashed: boolean;
}

export function AnnotationModal({ photo, onSave, onClose }: AnnotationModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<ToolType>('arrow');
  const [color, setColor] = useState('#ff0000');
  const [lineWidth, setLineWidth] = useState(3);
  const [dashed, setDashed] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationObject[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  // Load image
  useEffect(() => {
    const blob = photo?.annotatedBlob ?? photo?.blob;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // Render everything when annotations change or image loads
  useEffect(() => {
    if (!imgLoaded || !imgRef.current) return;
    renderCanvas();
  }, [imgLoaded, annotations]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const container = containerRef.current;
    if (!container) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight, 1);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const ox = (cw - dw) / 2;
    const oy = (ch - dh) / 2;

    scaleRef.current = scale;
    offsetRef.current = { x: ox, y: oy };

    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, ox, oy, dw, dh);

    // Draw annotations
    for (const ann of (annotations ?? [])) {
      drawAnnotation(ctx, ann, scale, ox, oy);
    }
  }, [annotations, imgLoaded]);

  const drawAnnotation = (
    ctx: CanvasRenderingContext2D,
    ann: AnnotationObject,
    scale: number,
    ox: number,
    oy: number
  ) => {
    ctx.save();
    ctx.strokeStyle = ann?.color ?? '#ff0000';
    ctx.lineWidth = ann?.lineWidth ?? 3;
    if (ann?.dashed) {
      ctx.setLineDash([8, 4]);
    } else {
      ctx.setLineDash([]);
    }

    const sx = (ann?.startX ?? 0) * scale + ox;
    const sy = (ann?.startY ?? 0) * scale + oy;
    const ex = (ann?.endX ?? 0) * scale + ox;
    const ey = (ann?.endY ?? 0) * scale + oy;

    switch (ann?.type) {
      case 'arrow': {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // Arrowhead
        const angle = Math.atan2(ey - sy, ex - sx);
        const headLen = 15;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - headLen * Math.cos(angle - Math.PI / 6),
          ey - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - headLen * Math.cos(angle + Math.PI / 6),
          ey - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
        break;
      }
      case 'circle': {
        const rx = Math.abs(ex - sx) / 2;
        const ry = Math.abs(ey - sy) / 2;
        const cx = (sx + ex) / 2;
        const cy = (sy + ey) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'rectangle': {
        ctx.beginPath();
        ctx.strokeRect(sx, sy, ex - sx, ey - sy);
        break;
      }
    }
    ctx.restore();
  };

  const getMousePos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      const touch = (e as React.TouchEvent)?.touches?.[0] ?? (e as React.TouchEvent)?.changedTouches?.[0];
      clientX = touch?.clientX ?? 0;
      clientY = touch?.clientY ?? 0;
    } else {
      clientX = (e as React.MouseEvent)?.clientX ?? 0;
      clientY = (e as React.MouseEvent)?.clientY ?? 0;
    }
    const scale = scaleRef.current;
    const offset = offsetRef.current;
    return {
      x: (clientX - rect.left - offset.x) / scale,
      y: (clientY - rect.top - offset.y) / scale,
    };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getMousePos(e);
    setStartPos(pos);
    setDrawing(true);
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing || !startPos) return;
    const pos = getMousePos(e);
    // Draw preview on overlay canvas
    const overlay = overlayCanvasRef.current;
    const canvas = canvasRef.current;
    if (!overlay || !canvas) return;
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawAnnotation(ctx, {
      type: tool,
      startX: startPos.x,
      startY: startPos.y,
      endX: pos.x,
      endY: pos.y,
      color,
      lineWidth,
      dashed,
    }, scaleRef.current, offsetRef.current.x, offsetRef.current.y);
  };

  const handleEnd = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing || !startPos) return;
    const pos = getMousePos(e);
    const ann: AnnotationObject = {
      type: tool,
      startX: startPos.x,
      startY: startPos.y,
      endX: pos.x,
      endY: pos.y,
      color,
      lineWidth,
      dashed,
    };
    setAnnotations((prev) => [...(prev ?? []), ann]);
    setDrawing(false);
    setStartPos(null);
    // Clear overlay
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      const ctx = overlay.getContext('2d');
      ctx?.clearRect(0, 0, overlay.width, overlay.height);
    }
  };

  const handleUndo = () => {
    setAnnotations((prev) => (prev ?? []).slice(0, -1));
  };

  const handleClearAll = () => {
    setAnnotations([]);
  };

  const handleSave = () => {
    const img = imgRef.current;
    if (!img) return;
    // Render at full resolution
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = img.naturalWidth;
    exportCanvas.height = img.naturalHeight;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    for (const ann of (annotations ?? [])) {
      drawAnnotation(ctx, ann, 1, 0, 0);
    }
    exportCanvas.toBlob((blob) => {
      if (blob) onSave(blob);
    }, 'image/jpeg', 0.92);
  };

  const colors = ['#ff0000', '#ff6600', '#ffcc00', '#00cc00', '#0066ff', '#9933ff', '#ffffff', '#000000'];

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Toolbar */}
      <div className="bg-card border-b p-2 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 border-r pr-2 mr-2">
          <Button
            variant={tool === 'arrow' ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={() => setTool('arrow')}
            title="Arrow"
          >
            <MoveRight className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'circle' ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={() => setTool('circle')}
            title="Circle/Ellipse"
          >
            <Circle className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'rectangle' ? 'default' : 'ghost'}
            size="icon-sm"
            onClick={() => setTool('rectangle')}
            title="Rectangle"
          >
            <Square className="w-4 h-4" />
          </Button>
        </div>

        {/* Colors */}
        <div className="flex items-center gap-1 border-r pr-2 mr-2">
          {colors.map((c) => (
            <button
              key={c}
              className={`w-6 h-6 rounded-full border-2 transition-all ${
                color === c ? 'border-primary scale-110' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>

        {/* Line width */}
        <div className="flex items-center gap-2 border-r pr-2 mr-2 min-w-[140px]">
          <Minus className="w-3 h-3 text-muted-foreground" />
          <Slider
            value={[lineWidth]}
            onValueChange={(v: number[]) => setLineWidth(v?.[0] ?? 3)}
            min={1}
            max={8}
            step={1}
            className="w-20"
          />
          <span className="text-xs text-muted-foreground w-6">{lineWidth}px</span>
        </div>

        {/* Dashed toggle */}
        <Button
          variant={dashed ? 'default' : 'outline'}
          size="xs"
          onClick={() => setDashed(!dashed)}
          className="mr-2"
        >
          {dashed ? '- - -' : '——'}
        </Button>

        <div className="flex-1" />

        <Button variant="ghost" size="icon-sm" onClick={handleUndo} title="Undo" disabled={(annotations?.length ?? 0) === 0}>
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={handleClearAll} title="Clear all" className="text-destructive" disabled={(annotations?.length ?? 0) === 0}>
          <Trash2 className="w-4 h-4" />
        </Button>
        <Button size="sm" onClick={handleSave} className="bg-accent text-accent-foreground hover:bg-accent/90">
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={() => { if (drawing) handleEnd({} as any); }}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
        />
      </div>
    </div>
  );
}
