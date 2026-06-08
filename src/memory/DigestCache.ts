export class DigestCache {
  private _cache = new Map<string, { hash: string; value: string }>();

  get(key: string, currentHash: string): string | null {
    const entry = this._cache.get(key);
    if (entry && entry.hash === currentHash) { return entry.value; }
    return null;
  }

  set(key: string, hash: string, value: string): void {
    this._cache.set(key, { hash, value });
  }

  invalidate(key?: string): void {
    if (key) { this._cache.delete(key); }
    else      { this._cache.clear(); }
  }

  static hashContent(content: string): string {
    return `${content.length}:${content.slice(0, 100)}`;
  }
}
