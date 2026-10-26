export function rotateImage(blob: Blob, degrees: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(blob); return; }
      
      const rad = (degrees * Math.PI) / 180;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      canvas.width = Math.round(img.width * cos + img.height * sin);
      canvas.height = Math.round(img.width * sin + img.height * cos);
      
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      
      canvas.toBlob((result) => {
        URL.revokeObjectURL(url);
        resolve(result ?? blob);
      }, 'image/jpeg', 0.92);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    img.src = url;
  });
}

export function createThumbnailUrl(blob: Blob | null | undefined): string {
  if (!blob) return '';
  return URL.createObjectURL(blob);
}
