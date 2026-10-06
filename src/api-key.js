import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';

const KDF_SALT = 'api-key-auth-v1';
const KDF_ITERATIONS = 210000;
const KDF_KEYLEN = 32;
const KDF_DIGEST = 'sha256';

const digest = (value) =>
  pbkdf2Sync(value, KDF_SALT, KDF_ITERATIONS, KDF_KEYLEN, KDF_DIGEST);

/**
 * x-api-key ヘッダーを期待値と定数時間で比較する Hono ミドルウェアを返す。
 * 期待値が未設定のときは全て拒否する (設定漏れで無認証公開になるのを防ぐ)。
 * OAuth の探索を始めさせないため、401 に WWW-Authenticate は付けない。
 */
export function apiKeyAuth(getExpected = () => process.env.GHEALTH_MCP_TOKEN) {
  return async (c, next) => {
    const expected = getExpected();
    const given = c.req.header('x-api-key');
    // 長さの違いが比較時間に出ないよう、ハッシュ同士を比べる
    if (!expected || !given || !timingSafeEqual(digest(given), digest(expected))) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}
