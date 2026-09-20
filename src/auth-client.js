import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** MCP サーバーは任意の作業ディレクトリから起動されるため、常に絶対パスで解決する */
const resolveCredential = (envName, fallback) =>
  process.env[envName] ? path.resolve(process.env[envName]) : path.join(repoRoot, fallback);

export const CLIENT_SECRET_PATH = resolveCredential('GHEALTH_CLIENT_SECRET', 'client_secret.json');
export const TOKEN_PATH = resolveCredential('GHEALTH_TOKEN', 'token.json');

/**
 * 環境変数だけから組み立てる。書き込めるファイルシステムが無い環境（Vercel など）用。
 * access token はリフレッシュのたびにメモリ上で更新されるだけで、どこにも保存しない。
 * Google はリフレッシュ時に refresh_token を差し替えないので、これで足りる。
 */
function createAuthClientFromEnv() {
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
 * なお GHEALTH_CLIENT_SECRET は、環境変数の経路ではシークレットの値そのもの、
 * ファイルの経路ではクライアント情報 JSON のパスという二役になっている。
 * どちらの経路になるかは GHEALTH_REFRESH_TOKEN の有無だけで決まるので取り違えは起きない。
 */
export function createAuthClient() {
  return process.env.GHEALTH_REFRESH_TOKEN
    ? createAuthClientFromEnv()
    : createAuthClientFromFiles();
}
