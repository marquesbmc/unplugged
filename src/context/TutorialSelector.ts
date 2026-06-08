import * as fs   from 'fs';
import * as path from 'path';

export class TutorialSelector {
  constructor(private readonly _extRoot: string) {}

  select(wsRoot: string, task: string): string[] {
    const tutDir = path.join(wsRoot, '.unplugged', 'tutorials');
    if (!fs.existsSync(tutDir)) { return []; }

    const words = task.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    if (!words.length) { return []; }

    const files = fs.readdirSync(tutDir).filter(f => f.endsWith('.md'));
    const scored = files.map(file => {
      const fileLower = file.toLowerCase();
      let score = 0;
      try {
        const firstLines = fs.readFileSync(path.join(tutDir, file), 'utf8').split('\n').slice(0, 5).join(' ').toLowerCase();
        for (const w of words) {
          if (fileLower.includes(w))   { score += 2; }
          if (firstLines.includes(w))  { score += 1; }
        }
      } catch { /* ok */ }
      return { file: path.join(tutDir, file), score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(s => s.file);
  }

  readAll(wsRoot: string): string {
    const tutDir = path.join(wsRoot, '.unplugged', 'tutorials');
    if (!fs.existsSync(tutDir)) { return ''; }

    const files = fs.readdirSync(tutDir).filter(f => f.endsWith('.md'));
    const parts: string[] = [];
    let total = 0;

    for (const file of files) {
      if (total >= 3000) { break; }
      try {
        let content = fs.readFileSync(path.join(tutDir, file), 'utf8');
        if (total + content.length > 3000) {
          content = content.slice(0, 3000 - total);
        }
        parts.push(content.trim());
        total += content.length;
      } catch { /* ok */ }
    }

    return parts.join('\n---\n');
  }
}
