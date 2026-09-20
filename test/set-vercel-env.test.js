import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  UserError,
  credentialEntries,
  credentialPaths,
  field,
  main,
  parseOptions,
  readJson,
  vercelArgs,
} from '../scripts/set-vercel-env.js';

// 実際の認証情報は一切使わない。すべて作り物の値
const CLIENT_JSON = JSON.stringify({
  installed: { client_id: 'dummy-id', client_secret: 'dummy-secret' },
});
const TOKEN_JSON = JSON.stringify({ refresh_token: 'dummy-refresh' });

const ROOT = '/repo';
const CLIENT_PATH = path.join(ROOT, 'client_secret.json');
const TOKEN_PATH = path.join(ROOT, 'token.json');

/** deps をまとめて差し替える。既定はすべて成功する経路 */
function makeDeps(overrides = {}) {
  const files = {
    [CLIENT_PATH]: CLIENT_JSON,
    [TOKEN_PATH]: TOKEN_JSON,
    ...overrides.files,
  };

  const out = [];
  const err = [];

  const deps = {
    root: ROOT,
    env: {},
    readFile: (file) => {
      if (!(file in files)) {
        const e = new Error(`ENOENT: ${file}`);
        e.code = 'ENOENT';
        throw e;
      }
      return files[file];
    },
    exists: () => true,
    spawn: vi.fn(() => ({ status: 0 })),
    log: (...args) => out.push(args.join(' ')),
    warn: (...args) => err.push(args.join(' ')),
    error: (...args) => err.push(args.join(' ')),
    randomToken: () => 'dummy-generated-token',
    ...overrides.deps,
  };

  return { deps, out, err, stdout: () => out.join('\n'), stderr: () => err.join('\n') };
}

const runMain = (argv = [], overrides = {}) => {
  const ctx = makeDeps(overrides);
  return { ...ctx, code: main(argv, ctx.deps) };
};

describe('parseOptions', () => {
  it('既定では production を対象にし、フラグはすべて false', () => {
    expect(parseOptions([])).toEqual({
      env: 'production',
      force: false,
      'mcp-token': false,
      plain: false,
      'dry-run': false,
      help: false,
    });
  });

  it('--env で対象の環境を差し替えられる', () => {
    expect(parseOptions(['--env', 'preview,production']).env).toBe('preview,production');
  });

  it('フラグを解釈する', () => {
    const opts = parseOptions(['--force', '--plain', '--dry-run', '--mcp-token']);
    expect(opts.force).toBe(true);
    expect(opts.plain).toBe(true);
    expect(opts['dry-run']).toBe(true);
    expect(opts['mcp-token']).toBe(true);
  });

  it('-h は --help と同じ', () => {
    expect(parseOptions(['-h']).help).toBe(true);
  });

  it('知らないオプションは UserError になる', () => {
    expect(() => parseOptions(['--bogus'])).toThrow(UserError);
  });

  it('--env の値を省略すると UserError になる', () => {
    expect(() => parseOptions(['--env'])).toThrow(UserError);
  });
});

describe('vercelArgs', () => {
  const opts = (over = {}) => ({ env: 'production', force: false, plain: false, ...over });

  it('既定では機微な値として追加する', () => {
    expect(vercelArgs('FOO', opts())).toEqual([
      'env',
      'add',
      'FOO',
      'production',
      '--yes',
      '--sensitive',
    ]);
  });

  it('--force を付けると --force が入る', () => {
    expect(vercelArgs('FOO', opts({ force: true }))).toContain('--force');
  });

  it('--plain を付けると --sensitive が外れる', () => {
    expect(vercelArgs('FOO', opts({ plain: true }))).not.toContain('--sensitive');
  });

  it('対象の環境をそのまま渡す', () => {
    expect(vercelArgs('FOO', opts({ env: 'preview,production' }))).toContain('preview,production');
  });

  it('値は引数に含めない（標準入力で渡すため）', () => {
    expect(vercelArgs('FOO', opts())).not.toContain('dummy-secret');
  });
});

describe('credentialPaths', () => {
  it('環境変数が無ければリポジトリ直下を見る', () => {
    expect(credentialPaths({}, ROOT)).toEqual({
      clientSecretPath: CLIENT_PATH,
      tokenPath: TOKEN_PATH,
    });
  });

  it('環境変数でパスを上書きできる', () => {
    const paths = credentialPaths(
      { GHEALTH_CLIENT_SECRET: '/tmp/c.json', GHEALTH_TOKEN: '/tmp/t.json' },
      ROOT,
    );
    expect(paths).toEqual({ clientSecretPath: '/tmp/c.json', tokenPath: '/tmp/t.json' });
  });
});

describe('readJson', () => {
  it('ファイルが無ければラベル付きの UserError になる', () => {
    const readFile = () => {
      const e = new Error('nope');
      e.code = 'ENOENT';
      throw e;
    };
    expect(() => readJson('/x.json', 'クライアント情報', readFile)).toThrow(
      /クライアント情報の取得元が見つかりません/,
    );
  });

  it('JSON が壊れていれば UserError になる', () => {
    expect(() => readJson('/x.json', 'トークン', () => '{ broken')).toThrow(UserError);
  });
});

describe('field', () => {
  it('値をそのまま返す', () => {
    expect(field('abc', 'ラベル', '/x.json')).toBe('abc');
  });

  it('未定義なら UserError になる', () => {
    expect(() => field(undefined, 'リフレッシュトークン', '/x.json')).toThrow(
      /リフレッシュトークンが \/x.json に入っていません/,
    );
  });

  it('空文字なら UserError になる', () => {
    expect(() => field('', 'ラベル', '/x.json')).toThrow(UserError);
  });

  it('複数行なら UserError になる', () => {
    expect(() => field('a\nb', 'ラベル', '/x.json')).toThrow(/複数行/);
  });
});

describe('credentialEntries', () => {
  it('3 つの環境変数の組を作る', () => {
    const entries = credentialEntries(
      JSON.parse(CLIENT_JSON),
      JSON.parse(TOKEN_JSON),
      CLIENT_PATH,
      TOKEN_PATH,
    );
    expect(entries).toEqual([
      ['GHEALTH_CLIENT_ID', 'dummy-id'],
      ['GHEALTH_CLIENT_SECRET', 'dummy-secret'],
      ['GHEALTH_REFRESH_TOKEN', 'dummy-refresh'],
    ]);
  });
});

describe('main', () => {
  it('3 つの環境変数を設定して 0 を返す', () => {
    const { code, deps } = runMain([]);

    expect(code).toBe(0);
    expect(deps.spawn).toHaveBeenCalledTimes(3);
    expect(deps.spawn.mock.calls.map(([, args]) => args[2])).toEqual([
      'GHEALTH_CLIENT_ID',
      'GHEALTH_CLIENT_SECRET',
      'GHEALTH_REFRESH_TOKEN',
    ]);
  });

  it('値は標準入力で渡し、引数には入れない', () => {
    const { deps } = runMain([]);

    for (const [command, args, options] of deps.spawn.mock.calls) {
      expect(command).toBe('vercel');
      expect(args).not.toContain(options.input);
      expect(options.stdio[0]).toBe('pipe');
    }
    expect(deps.spawn.mock.calls.map(([, , options]) => options.input)).toEqual([
      'dummy-id',
      'dummy-secret',
      'dummy-refresh',
    ]);
  });

  it('取り出した値を画面に出さない', () => {
    const { stdout, stderr } = runMain([]);

    for (const secret of ['dummy-id', 'dummy-secret', 'dummy-refresh']) {
      expect(stdout()).not.toContain(secret);
      expect(stderr()).not.toContain(secret);
    }
  });

  it('--dry-run では vercel を呼ばない', () => {
    const { code, deps, stdout } = runMain(['--dry-run']);

    expect(code).toBe(0);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(stdout()).toContain('dry-run のため何も変更していません。');
  });

  it('--mcp-token は 4 つ目として設定し、生成した値を表示する', () => {
    const { code, deps, stdout } = runMain(['--mcp-token']);

    expect(code).toBe(0);
    expect(deps.spawn).toHaveBeenCalledTimes(4);
    expect(deps.spawn.mock.calls[3][1]).toContain('GHEALTH_MCP_TOKEN');
    expect(deps.spawn.mock.calls[3][2].input).toBe('dummy-generated-token');
    // これは claude.ai 側にも設定する必要があるので、唯一表示してよい値
    expect(stdout()).toContain('dummy-generated-token');
  });

  it('--dry-run では生成したトークンも表示しない', () => {
    const { stdout } = runMain(['--dry-run', '--mcp-token']);
    expect(stdout()).not.toContain('dummy-generated-token');
  });

  it('--help は使い方を出して何もしない', () => {
    const { code, deps, stdout } = runMain(['--help']);

    expect(code).toBe(0);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(stdout()).toContain('npm run vercel:env');
  });

  it('リフレッシュトークンが欠けていれば 1 件も設定しない', () => {
    const { code, deps, stderr } = runMain([], {
      files: { [TOKEN_PATH]: JSON.stringify({ access_token: 'x' }) },
    });

    expect(code).toBe(1);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(stderr()).toContain('リフレッシュトークン');
  });

  it('vercel が失敗したら 1 を返し、失敗した名前を挙げる', () => {
    const spawn = vi.fn((_cmd, args) => ({ status: args.includes('GHEALTH_CLIENT_SECRET') ? 1 : 0 }));
    const { code, stderr } = runMain([], { deps: { spawn } });

    expect(code).toBe(1);
    expect(stderr()).toContain('GHEALTH_CLIENT_SECRET');
    expect(stderr()).toContain('--force を付けて実行してください');
  });

  it('--force 済みなら --force の案内は出さない', () => {
    const spawn = vi.fn(() => ({ status: 1 }));
    const { stderr } = runMain(['--force'], { deps: { spawn } });

    expect(stderr()).not.toContain('--force を付けて実行してください');
  });

  it('vercel が見つからなければ PATH の確認を促す', () => {
    const spawn = vi.fn(() => ({ error: Object.assign(new Error('enoent'), { code: 'ENOENT' }) }));
    const { code, stderr } = runMain([], { deps: { spawn } });

    expect(code).toBe(1);
    expect(stderr()).toContain('PATH を確認してください');
  });

  it('vercel link 前なら何もせず終わる', () => {
    const { code, deps, stderr } = runMain([], { deps: { exists: () => false } });

    expect(code).toBe(1);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(stderr()).toContain('vercel link');
  });

  it('vercel link 前でも --dry-run なら警告だけで続行する', () => {
    const { code, stderr, stdout } = runMain(['--dry-run'], { deps: { exists: () => false } });

    expect(code).toBe(0);
    expect(stderr()).toContain('警告');
    expect(stdout()).toContain('dry-run のため何も変更していません。');
  });

  it('知らないオプションは 1 を返す', () => {
    const { code, deps, stderr } = runMain(['--bogus']);

    expect(code).toBe(1);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(stderr()).toContain('オプションの指定が不正です');
  });

  it('環境変数で認証情報のパスを差し替えられる', () => {
    const { code, deps } = runMain([], {
      files: {
        '/tmp/c.json': CLIENT_JSON,
        '/tmp/t.json': TOKEN_JSON,
      },
      deps: { env: { GHEALTH_CLIENT_SECRET: '/tmp/c.json', GHEALTH_TOKEN: '/tmp/t.json' } },
    });

    expect(code).toBe(0);
    expect(deps.spawn).toHaveBeenCalledTimes(3);
  });
});
