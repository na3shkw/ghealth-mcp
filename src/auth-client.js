import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 手元の認証情報ファイルの場所。MCP サーバーは任意の作業ディレクトリから起動されるため常に絶対パスで解決する。
 * 初回認証（npm run auth）や scripts/ の調査用スクリプトも同じ固定パスを読み書きする。
 */
export const CLIENT_SECRET_PATH = path.join(repoRoot, 'client_secret.json');
export const TOKEN_PATH = path.join(repoRoot, 'token.json');

/** 環境変数の経路で GHEALTH_REFRESH_TOKEN と一緒に要る変数 */
const REQUIRED_ENV_KEYS = ['GHEALTH_CLIENT_ID', 'GHEALTH_CLIENT_SECRET'];

/**
 * 環境変数だけから組み立てる。書き込めるファイルシステムが無い環境（Vercel など）用。
 * access token はリフレッシュのたびにメモリ上で更新されるだけで、どこにも保存しない。
 * Google はリフレッシュ時に refresh_token を差し替えないので、これで足りる。
 */
function createAuthClientFromEnv() {
  // 欠けたまま組み立てると、最初の API 呼び出しで Google 側の不可解なエラーになる
  const missing = REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `GHEALTH_REFRESH_TOKEN があるので環境変数から認証情報を読みますが、${missing.join(
        ' / ',
      )} が設定されていません`,
    );
  }

  const auth = new OAuth2Client(process.env.GHEALTH_CLIENT_ID, process.env.GHEALTH_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GHEALTH_REFRESH_TOKEN });
  return auth;
}

/** 手元に保存したクライアント情報とトークンのファイルから組み立てる */
function createAuthClientFromFiles() {
  const { installed } = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
  const stored = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

  const auth = new OAuth2Client(installed.client_id, installed.client_secret);
  auth.setCredentials(stored);

  // リフレッシュ時のレスポンスに refresh_token は含まれないので既存の値とマージする
  auth.on('tokens', (tokens) => {
    const merged = { ...stored, ...tokens };
    if (!merged.refresh_token) delete merged.refresh_token;
    Object.assign(stored, merged);
    try {
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
    } catch (e) {
      console.error('トークンファイルの書き戻しに失敗:', e.message);
    }
  });

  return auth;
}

/**
 * GHEALTH_REFRESH_TOKEN があれば環境変数の経路、無ければファイルの経路を使う。
 * GHEALTH_CLIENT_SECRET は環境変数の経路でのみ参照し、常にシークレットの値そのものを表す。
 */
export function createAuthClient() {
  return process.env.GHEALTH_REFRESH_TOKEN
    ? createAuthClientFromEnv()
    : createAuthClientFromFiles();
}
