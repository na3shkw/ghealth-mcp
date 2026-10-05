import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/mcp-server.js';
import { main, worktreePath } from '../src/server.js';

const ROOT = '/work/repo';
const MODULE_PATH = '/work/topic/src/mcp-server.js';

/** deps をまとめて差し替える。既定は .env に相対パスの worktree が書かれた経路 */
function makeDeps({ files = {}, env = {}, module } = {}) {
  const all = { [path.join(ROOT, '.env')]: 'GHEALTH_WORKTREE=../topic\n', ...files };
  const worktreeCreateServer = () => {};
  return {
    worktreeCreateServer,
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
      importModule: vi.fn(async () => module ?? { createServer: worktreeCreateServer }),
      serve: vi.fn(),
      log: () => {},
    },
  };
}

describe('worktreePath', () => {
  it('.env の GHEALTH_WORKTREE を読む', () => {
    const { deps } = makeDeps();
    expect(worktreePath(deps)).toBe('../topic');
  });

  it('実際の環境変数を .env より優先する', () => {
    const { deps } = makeDeps({ env: { GHEALTH_WORKTREE: '/elsewhere/other' } });
    expect(worktreePath(deps)).toBe('/elsewhere/other');
  });

  it('.env が無ければ undefined', () => {
    const { deps } = makeDeps({ files: { [path.join(ROOT, '.env')]: null } });
    expect(worktreePath(deps)).toBeUndefined();
  });

  it('.env のほかの変数は環境変数に取り込まない', () => {
    const env = {};
    const { deps } = makeDeps({
      env,
      files: { [path.join(ROOT, '.env')]: 'GHEALTH_WORKTREE=../topic\nGHEALTH_TZ=UTC\n' },
    });

    worktreePath(deps);

    expect(env).toEqual({});
  });

  it('空の値は未設定として扱う', () => {
    const { deps } = makeDeps({ files: { [path.join(ROOT, '.env')]: 'GHEALTH_WORKTREE=\n' } });
    expect(worktreePath(deps)).toBeUndefined();
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

  it('絶対パスの worktree はそのまま使う', async () => {
    const { deps } = makeDeps({ env: { GHEALTH_WORKTREE: '/elsewhere/topic' } });

    await main(['--worktree'], deps);

    expect(deps.importModule).toHaveBeenCalledWith('file:///elsewhere/topic/src/mcp-server.js');
  });

  it('createServer を export していない worktree は起動せずに落ちる', async () => {
    const { deps } = makeDeps({ module: {} });

    await expect(main(['--worktree'], deps)).rejects.toThrow(/createServer/);
    expect(deps.serve).not.toHaveBeenCalled();
  });
});
