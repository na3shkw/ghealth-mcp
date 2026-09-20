import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

/** ダミーの認証情報を書いた一時ディレクトリを作り、そのパスを環境変数に入れる */
function setupCredentialFiles(token) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghealth-auth-'));
  const clientPath = path.join(dir, 'client.json');
  const tokenPath = path.join(dir, 'token-store.json');

  fs.writeFileSync(
    clientPath,
    JSON.stringify({ installed: { client_id: 'file-id', client_secret: 'file-secret' } }),
  );
  fs.writeFileSync(tokenPath, JSON.stringify(token));

  process.env.GHEALTH_CLIENT_SECRET = clientPath;
  process.env.GHEALTH_TOKEN = tokenPath;
  return { dir, tokenPath };
}

/** 環境変数はモジュール読み込み時に評価されるので、毎回読み直す */
const loadModule = () => {
  vi.resetModules();
  return import('../src/auth-client.js');
};

const ENV_KEYS = [
  'GHEALTH_CLIENT_ID',
  'GHEALTH_CLIENT_SECRET',
  'GHEALTH_REFRESH_TOKEN',
  'GHEALTH_TOKEN',
];

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
      spy.mockRestore();
    });

    it('tokens イベントを購読しない（書き戻しをしない）', async () => {
      const { createAuthClient } = await loadModule();
      const auth = createAuthClient();

      expect(auth.listeners.has('tokens')).toBe(false);
    });
  });

  describe('ファイルの経路', () => {
    it('GHEALTH_REFRESH_TOKEN が無ければファイルから組み立てる', async () => {
      setupCredentialFiles({ refresh_token: 'stored-refresh', access_token: 'stored-access' });

      const { createAuthClient } = await loadModule();
      const auth = createAuthClient();

      expect(auth.clientId).toBe('file-id');
      expect(auth.clientSecret).toBe('file-secret');
      expect(auth.credentials).toEqual({
        refresh_token: 'stored-refresh',
        access_token: 'stored-access',
      });
    });

    it('tokens イベントで新しい access token を書き戻す', async () => {
      const { tokenPath } = setupCredentialFiles({
        refresh_token: 'stored-refresh',
        access_token: 'old-access',
      });

      const { createAuthClient } = await loadModule();
      const auth = createAuthClient();
      // リフレッシュのレスポンスに refresh_token は含まれない
      auth.fire('tokens', { access_token: 'new-access' });

      expect(JSON.parse(fs.readFileSync(tokenPath, 'utf8'))).toEqual({
        refresh_token: 'stored-refresh',
        access_token: 'new-access',
      });
    });
  });
});
