import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/mcp-server.js';
import { main, worktreeModulePath, worktreeName } from '../src/server.js';

// 実際の認証情報は一切使わない。すべて作り物の値
const ROOT = '/repo';
const FILES = {
  [path.join(ROOT, 'client_secret.json')]: JSON.stringify({
    installed: { client_id: 'dummy-id', client_secret: 'dummy-secret' },
  }),
  [path.join(ROOT, 'token.json')]: JSON.stringify({ refresh_token: 'dummy-refresh' }),
};
const MODULE_PATH = path.join(ROOT, '.wt', 'add-hrv', 'src', 'mcp-server.js');

/** deps をまとめて差し替える。既定は .env に add-hrv が書かれ、worktree も存在する経路 */
function makeDeps({ files = {}, env = {}, exists = () => true, module } = {}) {
  const all = { [path.join(ROOT, '.env')]: 'GHEALTH_WORKTREE=add-hrv\n', ...FILES, ...files };
  const worktreeCreateServer = () => {};
  const logs = [];
  return {
    worktreeCreateServer,
    logs,
    deps: {
      root: ROOT,
      env,
      readFile: (file) => {
        if (all[file] == null) {
          const e = new Error(`ENOENT: ${file}`);
          e.code = 'ENOENT';
          throw e;
        }
        return all[file];
      },
      exists,
      importModule: vi.fn(async () => module ?? { createServer: worktreeCreateServer }),
      serve: vi.fn(),
      log: (...args) => logs.push(args.join(' ')),
    },
  };
}

describe('worktreeName', () => {
  it('.env の GHEALTH_WORKTREE を読む', () => {
    const { deps } = makeDeps();
    expect(worktreeName(deps)).toBe('add-hrv');
  });

  it('実際の環境変数を .env より優先する', () => {
    const { deps } = makeDeps({ env: { GHEALTH_WORKTREE: 'other' } });
    expect(worktreeName(deps)).toBe('other');
  });

  it('.env が無ければ undefined', () => {
    const { deps } = makeDeps({ files: { [path.join(ROOT, '.env')]: null } });
    expect(worktreeName(deps)).toBeUndefined();
  });

  it('空の値は未設定として扱う', () => {
    const { deps } = makeDeps({ files: { [path.join(ROOT, '.env')]: 'GHEALTH_WORKTREE=\n' } });
    expect(worktreeName(deps)).toBeUndefined();
  });
});

describe('worktreeModulePath', () => {
  it('.wt/<名前>/src/mcp-server.js を指す', () => {
    expect(worktreeModulePath(ROOT, 'add-hrv')).toBe(MODULE_PATH);
  });

  it.each(['../evil', '/tmp/x', '.', ''])('.wt 直下の外を指す名前は拒む: %j', (name) => {
    expect(() => worktreeModulePath(ROOT, name)).toThrow(/worktree 名/);
  });
});

describe('main', () => {
  it('--worktree が無ければ .env を読まずにこのリポジトリで起動する', async () => {
    const { deps } = makeDeps();
    const readFile = vi.spyOn(deps, 'readFile');

    await main([], deps);

    expect(readFile).not.toHaveBeenCalled();
    expect(deps.serve).toHaveBeenCalledWith(createServer);
  });

  it('GHEALTH_WORKTREE が未設定ならこのリポジトリで起動する', async () => {
    const { deps } = makeDeps({ files: { [path.join(ROOT, '.env')]: null } });

    await main(['--worktree'], deps);

    expect(deps.importModule).not.toHaveBeenCalled();
    expect(deps.serve).toHaveBeenCalledWith(createServer);
  });

  it('worktree の createServer で起動する', async () => {
    const { deps, worktreeCreateServer } = makeDeps();

    await main(['--worktree'], deps);

    expect(deps.importModule).toHaveBeenCalledWith(`file://${MODULE_PATH}`);
    expect(deps.serve).toHaveBeenCalledWith(worktreeCreateServer);
  });

  it('認証情報を環境変数の経路で渡し、.env のほかの変数は取り込まない', async () => {
    const env = {};
    const { deps } = makeDeps({
      env,
      files: { [path.join(ROOT, '.env')]: 'GHEALTH_WORKTREE=add-hrv\nGHEALTH_TZ=UTC\n' },
    });

    await main(['--worktree'], deps);

    expect(env).toEqual({
      GHEALTH_CLIENT_ID: 'dummy-id',
      GHEALTH_CLIENT_SECRET: 'dummy-secret',
      GHEALTH_REFRESH_TOKEN: 'dummy-refresh',
    });
  });

  it('ログに認証情報の値を出さない', async () => {
    const { deps, logs } = makeDeps();

    await main(['--worktree'], deps);

    const out = logs.join('\n');
    for (const secret of ['dummy-id', 'dummy-secret', 'dummy-refresh']) {
      expect(out).not.toContain(secret);
    }
  });

  it('worktree が無ければ起動せずに落ちる', async () => {
    const { deps } = makeDeps({ exists: () => false });

    await expect(main(['--worktree'], deps)).rejects.toThrow(MODULE_PATH);
    expect(deps.serve).not.toHaveBeenCalled();
  });

  it('createServer を export していない worktree は起動せずに落ちる', async () => {
    const { deps } = makeDeps({ module: {} });

    await expect(main(['--worktree'], deps)).rejects.toThrow(/createServer/);
    expect(deps.serve).not.toHaveBeenCalled();
  });

  it('認証情報が欠けていれば worktree を読み込む前に落ちる', async () => {
    const { deps } = makeDeps({
      files: { [path.join(ROOT, 'token.json')]: JSON.stringify({}) },
    });

    await expect(main(['--worktree'], deps)).rejects.toThrow(/リフレッシュトークン/);
    expect(deps.importModule).not.toHaveBeenCalled();
  });
});
