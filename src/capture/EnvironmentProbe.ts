import * as cp from 'child_process';

export interface EnvironmentInfo {
  platform:    string;
  nodeVersion: string;
  runtimes:    string[];
  envVars:     string[];
}

const ENV_PREFIXES = ['DATABASE_', 'DB_', 'API_', 'PORT', 'HOST', 'SECRET', 'TOKEN', 'KEY_', 'REDIS', 'MONGO', 'POSTGRES'];

export class EnvironmentProbe {
  probe(): EnvironmentInfo {
    const platform =
      process.platform === 'win32'  ? 'Windows' :
      process.platform === 'darwin' ? 'macOS'   : 'Linux';

    const runtimes: string[] = [`Node ${process.version}`];
    const cmds: [string, string][] = [
      ['python --version', 'Python'],
      ['python3 --version', 'Python'],
      ['go version', 'Go'],
      ['rustc --version', 'Rust'],
    ];
    for (const [cmd, label] of cmds) {
      try {
        const out = cp.execSync(cmd, { timeout: 2000, stdio: ['pipe','pipe','pipe'] }).toString().trim();
        const ver = out.split(/\s+/)[1] ?? '';
        if (ver && !runtimes.some(r => r.startsWith(label))) {
          runtimes.push(`${label} ${ver}`);
        }
      } catch { /* não instalado */ }
    }

    const envVars = Object.keys(process.env).filter(k =>
      ENV_PREFIXES.some(p => k.startsWith(p))
    );

    return { platform, nodeVersion: process.version, runtimes, envVars };
  }
}
