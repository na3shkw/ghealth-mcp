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

export function createAuthClient() {
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
      console.error('token.json の書き戻しに失敗:', e.message);
    }
  });

  return auth;
}
