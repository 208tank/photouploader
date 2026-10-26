export interface ParsedFilename {
  order: number;
  description: string;
  original: string;
}

export function parseFilename(filename: string): ParsedFilename {
  const nameWithoutExt = filename?.replace(/\.[^.]+$/, '') ?? '';
  
  // Match patterns like "001 - Tank Overview" or "1 Tank Overview" or "001_Tank_Overview"
  const match = nameWithoutExt.match(/^(\d+)\s*[-_]?\s*(.*)$/);
  
  if (match) {
    return {
      order: parseInt(match[1] ?? '0', 10),
      description: (match[2] ?? '').replace(/[_-]/g, ' ').trim() || nameWithoutExt,
      original: filename,
    };
  }
  
  return {
    order: 0,
    description: nameWithoutExt.replace(/[_-]/g, ' ').trim() || 'Untitled',
    original: filename,
  };
}

export function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 800, height: 600 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
