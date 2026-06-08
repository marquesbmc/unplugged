import * as vscode from 'vscode';
import * as fs      from 'fs';
import * as path    from 'path';
import { ConfigScanner, ConfigInfo }     from './ConfigScanner';
import { EnvironmentProbe, EnvironmentInfo } from './EnvironmentProbe';
import { GitAnalyzer, GitInfo }          from './GitAnalyzer';

export interface WorkspaceSnapshot {
  config:      ConfigInfo;
  environment: EnvironmentInfo;
  git:         GitInfo;
  fileCount:   number;
  topFiles:    string[];
}

const TOP_CANDIDATES = [
  'src/extension.ts', 'src/index.ts', 'src/main.ts', 'src/app.ts',
  'index.ts', 'main.ts', 'app.ts', 'index.js', 'main.py', 'main.go',
  'README.md',
];

export class WorkspaceCapture {
  constructor(
    private readonly scanner: ConfigScanner,
    private readonly probe:   EnvironmentProbe,
    private readonly git:     GitAnalyzer,
  ) {}

  async capture(wsRoot: string): Promise<WorkspaceSnapshot> {
    const [config, environment, git] = await Promise.all([
      Promise.resolve(this.scanner.scan(wsRoot)),
      Promise.resolve(this.probe.probe()),
      Promise.resolve(this.git.analyze(wsRoot)),
    ]);

    const files     = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 1000);
    const fileCount = files.length;

    const topFiles = TOP_CANDIDATES.filter(c => fs.existsSync(path.join(wsRoot, c)));

    return { config, environment, git, fileCount, topFiles };
  }
}
