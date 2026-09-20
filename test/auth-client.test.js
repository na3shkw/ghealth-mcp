import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// OAuth2Client に何が渡ったかを見たいだけなので、最低限の振る舞いだけ持つ差し替えを使う
const { instances, FakeOAuth2Client } = vi.hoisted(() => {
  const instances = [];
  class FakeOAuth2Client {
    constructor(clientId, clientSecret) {
      this.clientId = clientId;
      this.clientSecret = clientSecret;
      this.credentials = undefined;
      this.listeners = new Map();
      instances.push(this);
    }
    setCredentials(credentials) {
      this.credentials = credentials;
    }
    on(event, handler) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(handler);
    }
    /** 本物が発火させる tokens イベントを手で起こす */
    fire(event, arg) {
      for (const handler of this.listeners.get(event) ?? []) handler(arg);
    }
  }
  return { instances, FakeOAuth2Client };
});

vi.mock('google-auth-library', () => ({ OAuth2Client: FakeOAuth2Client }));

/**
 * 認証情報ファイルの中身をメモリ上で差し替える。実ファイル（リポジトリ直下の本物）には
 * 読み書きとも一切触らない。
 */
function setupCredentialFiles({ clientSecretPath, tokenPath }, token) {
  const files = {
    [clientSecretPath]: JSON.stringify({
      installed: { client_id: 'file-id', client_secret: 'file-secret' },
    }),
    [tokenPath]: JSON.stringify(token),
  };

  vi.spyOn(fs, 'readFileSync').mockImplementation((file) => {
    if (!(file in files)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
    return files[file];
  });
  vi.spyOn(fs, 'writeFileSync').mockImplementation((file, text) => {
    files[file] = text;
  });

  return { files, written: () => JSON.parse(files[tokenPath]) };
}

/** 環境変数を設定してから読み込み直す。読み込み時に評価されていないことも含めて見るため */
const loadModule = () => {
  vi.resetModules();
  return import('../src/auth-client.js');
};

const ENV_KEYS = ['GHEALTH_CLIENT_ID', 'GHEALTH_CLIENT_SECRET', 'GHEALTH_REFRESH_TOKEN'];

describe('createAuthClient', () => {
  const saved = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    instances.length = 0;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  describe('環境変数の経路', () => {
    beforeEach(() => {
      process.env.GHEALTH_CLIENT_ID = 'env-id';
      process.env.GHEALTH_CLIENT_SECRET = 'env-secret';
      process.env.GHEALTH_REFRESH_TOKEN = 'env-refresh';
    });

    it('GHEALTH_REFRESH_TOKEN があれば環境変数から組み立てる', async () => {
      const { createAuthClient } = await loadModule();
      const auth = createAuthClient();

      expect(auth.clientId).toBe('env-id');
      expect(auth.clientSecret).toBe('env-secret');
      expect(auth.credentials).toEqual({ refresh_token: 'env-refresh' });
    });

    it('ファイルを一切読まない', async () => {
      const spy = vi.spyOn(fs, 'readFileSync');
      const { createAuthClient } = await loadModule();
      createAuthClient();

      expect(spy).not.toHaveBeenCalled();
    });

    it('tokens イベントを購読しない（書き戻しをしない）', async () => {
      const { createAuthClient } = await loadModule();
      const auth = createAuthClient();

      expect(auth.listeners.has('tokens')).toBe(false);
    });

    it.each([['GHEALTH_CLIENT_ID'], ['GHEALTH_CLIENT_SECRET']])(
      '%s が欠けていれば、その名前を挙げて失敗する',
      async (missing) => {
        delete process.env[missing];
        const { createAuthClient } = await loadModule();

        expect(() => createAuthClient()).toThrow(missing);
        expect(instances).toHaveLength(0);
      },
    );

    it('両方欠けていれば両方の名前を挙げる', async () => {
      delete process.env.GHEALTH_CLIENT_ID;
      delete process.env.GHEALTH_CLIENT_SECRET;
      const { createAuthClient } = await loadModule();

      expect(() => createAuthClient()).toThrow(/GHEALTH_CLIENT_ID \/ GHEALTH_CLIENT_SECRET/);
    });

    it('空文字は未設定として扱う', async () => {
      process.env.GHEALTH_CLIENT_SECRET = '';
      const { createAuthClient } = await loadModule();

      expect(() => createAuthClient()).toThrow('GHEALTH_CLIENT_SECRET');
    });
  });

  describe('ファイルの経路', () => {
    it('認証情報の場所は環境変数では変えられない', async () => {
      process.env.GHEALTH_CLIENT_SECRET = '/tmp/どこか別の場所.json';
      const paths = await loadModule();

      // GHEALTH_CLIENT_SECRET は環境変数の経路のシークレットの値専用で、パスとしては見ない
      expect(paths.CLIENT_SECRET_PATH).toMatch(/[/\\]client_secret\.json$/);
      expect(paths.CLIENT_SECRET_PATH).not.toContain('別の場所');
      expect(paths.TOKEN_PATH).toMatch(/[/\\]token\.json$/);
    });

    it('GHEALTH_REFRESH_TOKEN が無ければファイルから組み立てる', async () => {
      const paths = await loadModule();
      setupCredentialFiles(pathsOf(paths), {
        refresh_token: 'stored-refresh',
        access_token: 'stored-access',
      });

      const auth = paths.createAuthClient();

      expect(auth.clientId).toBe('file-id');
      expect(auth.clientSecret).toBe('file-secret');
      expect(auth.credentials).toEqual({
        refresh_token: 'stored-refresh',
        access_token: 'stored-access',
      });
    });

    it('tokens イベントで新しい access token を書き戻す', async () => {
      const module = await loadModule();
      const { written } = setupCredentialFiles(pathsOf(module), {
        refresh_token: 'stored-refresh',
        access_token: 'old-access',
      });

      const auth = module.createAuthClient();
      // リフレッシュのレスポンスに refresh_token は含まれない
      auth.fire('tokens', { access_token: 'new-access' });

      expect(written()).toEqual({
        refresh_token: 'stored-refresh',
        access_token: 'new-access',
      });
    });
  });
});

/** 読み込んだモジュールから、差し替え対象のファイルパスを取り出す */
function pathsOf({ CLIENT_SECRET_PATH, TOKEN_PATH }) {
  return { clientSecretPath: CLIENT_SECRET_PATH, tokenPath: TOKEN_PATH };
}
