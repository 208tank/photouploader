'use client';

import { useEffect } from 'react';

export function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/photouploader/sw.js').catch(() => {
        // SW registration failed — app still works, just not offline
      });
    }
  }, []);

  return null;
}
