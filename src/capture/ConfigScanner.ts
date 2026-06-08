import * as fs   from 'fs';
import * as path from 'path';
import { DigestCache } from '../memory/DigestCache';

export interface ConfigInfo {
  packageJson?:   Record<string, unknown>;
  mainLanguage:   string;
  frameworks:     string[];
  hasTests:       boolean;
  hasCi:          boolean;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'pip' | 'cargo' | 'go' | 'unknown';
  configFiles:    string[];
}

const FRAMEWORK_DEPS: Record<string, string> = {
  react: 'React', vue: 'Vue', angular: '@angular/core',
  express: 'Express', fastify: 'Fastify', nextjs: 'Next.js',
  nestjs: 'NestJS', prisma: 'Prisma', drizzle: 'Drizzle',
};

export class ConfigScanner {
  private _cache = new DigestCache();

  scan(wsRoot: string): ConfigInfo {
    const pkgPath = path.join(wsRoot, 'package.json');
    const hash    = fs.existsSync(pkgPath)
      ? DigestCache.hashContent(fs.readFileSync(pkgPath, 'utf8'))
      : 'none';

    const cached = this._cache.get('config', hash);
    if (cached) { return JSON.parse(cached) as ConfigInfo; }

    const result = this._doScan(wsRoot);
    this._cache.set('config', hash, JSON.stringify(result));
    return result;
  }

  invalidateCache(): void { this._cache.invalidate(); }

  private _doScan(wsRoot: string): ConfigInfo {
    const exists = (f: string) => fs.existsSync(path.join(wsRoot, f));

    let packageJson: Record<string, unknown> | undefined;
    if (exists('package.json')) {
      try { packageJson = JSON.parse(fs.readFileSync(path.join(wsRoot, 'package.json'), 'utf8')) as Record<string, unknown>; }
      catch { /* ok */ }
    }

    const allDeps = {
      ...((packageJson?.dependencies  as Record<string, unknown>) ?? {}),
      ...((packageJson?.devDependencies as Record<string, unknown>) ?? {}),
    };

    const frameworks: string[] = [];
    for (const [dep, label] of Object.entries(FRAMEWORK_DEPS)) {
      if (Object.keys(allDeps).some(k => k.includes(dep))) { frameworks.push(label); }
    }

    const mainLanguage =
      exists('tsconfig.json')      ? 'TypeScript' :
      exists('pyproject.toml') || exists('requirements.txt') ? 'Python' :
      exists('Cargo.toml')          ? 'Rust' :
      exists('go.mod')              ? 'Go' :
      exists('package.json')        ? 'JavaScript' : 'Desconhecida';

    const packageManager =
      exists('yarn.lock')   ? 'yarn' :
      exists('pnpm-lock.yaml') ? 'pnpm' :
      exists('package.json')   ? 'npm' :
      exists('requirements.txt') ? 'pip' :
      exists('Cargo.toml')       ? 'cargo' :
      exists('go.mod')           ? 'go' : 'unknown';

    const hasTests =
      exists('jest.config.js') || exists('jest.config.ts') || exists('vitest.config.ts') ||
      exists('test') || exists('__tests__') ||
      Object.keys(allDeps).some(k => ['jest','vitest','mocha','pytest'].some(t => k.includes(t)));

    const hasCi =
      exists('.github/workflows') || exists('.gitlab-ci.yml') || exists('Jenkinsfile');

    const knownConfigs = [
      'tsconfig.json', '.eslintrc.json', '.eslintrc.js', '.eslintrc.yaml',
      '.prettierrc', '.prettierrc.json', 'vite.config.ts', 'webpack.config.js',
      '.env.example', 'docker-compose.yml', 'Dockerfile',
    ];
    const configFiles = knownConfigs.filter(c => exists(c));

    return { packageJson, mainLanguage, frameworks, hasTests, hasCi, packageManager, configFiles };
  }
}
