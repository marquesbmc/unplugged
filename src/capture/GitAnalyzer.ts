import * as cp from 'child_process';

export interface GitInfo {
  branch:         string;
  recentCommits:  string[];
  modifiedFiles:  string[];
  hasUncommitted: boolean;
}

const EMPTY: GitInfo = { branch: '', recentCommits: [], modifiedFiles: [], hasUncommitted: false };

export class GitAnalyzer {
  analyze(wsRoot: string): GitInfo {
    try {
      const exec = (cmd: string) =>
        cp.execSync(cmd, { cwd: wsRoot, timeout: 5000, stdio: ['pipe','pipe','pipe'] }).toString().trim();

      const branch = (() => { try { return exec('git rev-parse --abbrev-ref HEAD'); } catch { return ''; } })();
      if (!branch) { return EMPTY; }

      const recentCommits = (() => {
        try { return exec('git log --oneline -5').split('\n').filter(Boolean); }
        catch { return []; }
      })();

      const statusOut = (() => { try { return exec('git status --short'); } catch { return ''; } })();
      const modifiedFiles = statusOut.split('\n').filter(Boolean).map(l => l.slice(3));
      const hasUncommitted = modifiedFiles.length > 0;

      return { branch, recentCommits, modifiedFiles, hasUncommitted };
    } catch {
      return EMPTY;
    }
  }
}
