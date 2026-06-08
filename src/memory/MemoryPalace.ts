import * as fs   from 'fs';
import * as path from 'path';
import { MemoryEntry, EntryType } from './MemoryEntry';

export class MemoryPalace {
  private readonly _filePath: string;
  private _entries: MemoryEntry[] = [];

  constructor(wsRoot: string) {
    const dir = path.join(wsRoot, '.unplugged', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    this._filePath = path.join(dir, 'palace.json');
    this._load();
  }

  save(entry: MemoryEntry): void {
    const idx = this._entries.findIndex(e => e.id === entry.id);
    if (idx >= 0) {
      this._entries[idx] = entry;
    } else {
      this._entries.push(entry);
    }
    this._persist();
  }

  search(query: string, limit = 20): MemoryEntry[] {
    if (!query.trim()) { return this.list(undefined, limit); }
    const q = query.toLowerCase();
    return this._entries
      .filter(e =>
        e.title.toLowerCase().includes(q)   ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      )
      .slice(0, limit);
  }

  list(type?: EntryType, limit = 100): MemoryEntry[] {
    const filtered = type
      ? this._entries.filter(e => e.type === type)
      : [...this._entries];
    return filtered
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
  }

  delete(id: string): void {
    this._entries = this._entries.filter(e => e.id !== id);
    this._persist();
  }

  nextId(type: EntryType): string {
    const count = this._entries.filter(e => e.type === type).length;
    return `${type}_${count + 1}`;
  }

  private _load(): void {
    try {
      const raw = fs.readFileSync(this._filePath, 'utf8');
      this._entries = JSON.parse(raw) as MemoryEntry[];
    } catch {
      this._entries = [];
    }
  }

  private _persist(): void {
    fs.writeFileSync(this._filePath, JSON.stringify(this._entries, null, 2), 'utf8');
  }
}
