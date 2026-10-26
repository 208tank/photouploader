import Dexie, { type EntityTable } from 'dexie';

export interface PhotoRecord {
  id?: number;
  sessionId: number;
  order: number;
  fileName: string;
  description: string;
  blob: Blob;
  annotatedBlob: Blob | null;
  rotation: number;
  width: number;
  height: number;
  createdAt: number;
}

export interface SessionRecord {
  id?: number;
  name: string;
  layoutMode: 'three' | 'two' | 'optimize';
  // Report header/footer content (filled into the selected template).
  clientName?: string;
  inspectionTitle?: string;
  appendixLabel?: string;
  projectReference?: string;
  templateId?: number;
  // When true, export prepends a native Word table of contents (updatable field).
  includeToc?: boolean;
  createdAt: number;
  updatedAt: number;
}

// A reusable branding template (logo + letterhead styling) the inspector can pick per report.
export interface TemplateRecord {
  id?: number;
  name: string;
  logoBlob: Blob | null;
  logoType: 'png' | 'jpg';
  footerTagline: string;
  accentColor: string; // hex without '#'
  defaultLayout: 'three' | 'two' | 'optimize';
  isDefault: boolean;
  builtIn: boolean;
  // When set, this .docx is filled directly on export so the report matches the
  // supplied template exactly (letterhead, logo, fonts, margins). Falls back to the
  // code-generated layout when absent (logo-only custom templates).
  baseDocx?: Blob | null;
  createdAt: number;
}

// Simple key/value store for app-wide preferences (e.g. the chosen export folder handle).
export interface SettingRecord {
  key: string;
  value: any;
}

class InspectorDB extends Dexie {
  sessions!: EntityTable<SessionRecord, 'id'>;
  photos!: EntityTable<PhotoRecord, 'id'>;
  templates!: EntityTable<TemplateRecord, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor() {
    super('InspectorPhotoDB');
    this.version(1).stores({
      sessions: '++id, name, createdAt, updatedAt',
      photos: '++id, sessionId, order, fileName',
    });
    this.version(2).stores({
      sessions: '++id, name, createdAt, updatedAt',
      photos: '++id, sessionId, order, fileName',
      templates: '++id, name, isDefault, createdAt',
    });
    this.version(3).stores({
      sessions: '++id, name, createdAt, updatedAt',
      photos: '++id, sessionId, order, fileName',
      templates: '++id, name, isDefault, createdAt',
      settings: '&key',
    });
  }
}

export const db = new InspectorDB();
