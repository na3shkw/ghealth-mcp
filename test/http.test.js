// HTTP トランスポート経由の振る舞いをまとめて見るテスト。
// 対象は src/index.js（Hono アプリ）と、そこに挟まる src/api-key.js。
// ソースと 1 対 1 に対応させず、「HTTP で叩いたときに何が起きるか」で切っている。
// Google Health API は auth-client ごとモックするので、外に出る通信は無い。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('../src/auth-client.js', () => ({ createAuthClient: () => ({ request }) }));

const app = (await import('../src/index.js')).default;

const TOKEN = 'test-token-not-a-real-secret';

/** GHEALTH_MCP_TOKEN を退避・復元する。実行環境に設定されていても壊さないため */
function useToken(value = TOKEN) {
  let saved;
  beforeEach(() => {
    saved = process.env.GHEALTH_MCP_TOKEN;
    process.env.GHEALTH_MCP_TOKEN = value;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.GHEALTH_MCP_TOKEN;
    else process.env.GHEALTH_MCP_TOKEN = saved;
  });
}

/** 応答は SSE か JSON のどちらか。JSON-RPC のエンベロープまで解いて返す */
async function body(res) {
  const text = await res.text();
  const data = text.startsWith('{')
    ? text
    : text
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice('data:'.length);

  expect(data, `応答から JSON を取り出せない: ${text}`).toBeDefined();
  return JSON.parse(data);
}

const rpc = (method, params = {}, headers = {}) =>
  app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

const initialize = (headers) =>
  rpc(
    'initialize',
    {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.0' },
    },
    headers,
  );

describe('/mcp の認証', () => {
  useToken();

  it('x-api-key が無ければ 401 を返す', async () => {
    const res = await initialize();
    expect(res.status).toBe(401);
  });

  it('x-api-key が違えば 401 を返す', async () => {
    const res = await initialize({ 'x-api-key': 'wrong' });
    expect(res.status).toBe(401);
  });

  it('401 には OAuth の探索を始めさせる WWW-Authenticate を付けない', async () => {
    const res = await initialize();
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  // 設定漏れで無認証公開にならないことを見ている。空文字だけだと
  // 「キーが空だから 401」でも通ってしまうので、非空の値を必ず含める
  it.each([['anything'], [''], [TOKEN]])(
    '環境変数が未設定なら、x-api-key が %j でも 401 を返す',
    async (given) => {
      delete process.env.GHEALTH_MCP_TOKEN;
      const res = await initialize({ 'x-api-key': given });
      expect(res.status).toBe(401);
    },
  );

  it('x-api-key が正しければ initialize に応答する', async () => {
    const res = await initialize({ 'x-api-key': TOKEN });
    expect(res.status).toBe(200);
  });
});

describe('/mcp のツール', () => {
  useToken();
  beforeEach(() => {
    request.mockReset();
  });

  it('tools/list に載るのはこの 6 つだけ', async () => {
    const res = await rpc('tools/list', {}, { 'x-api-key': TOKEN });
    expect(res.status).toBe(200);

    // 意図せず増えたツールが公開されたままにならないよう、件数と順序ごと固定する
    const { result } = await body(res);
    expect(result.tools.map((t) => t.name)).toEqual([
      'list_exercises',
      'get_exercise',
      'get_exercise_minutes',
      'get_resting_heart_rate',
      'get_hrv',
      'get_sleep',
    ]);
  });

  it('tools/call は整形済みの結果を JSON テキストで返す', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });

    const res = await rpc(
      'tools/call',
      { name: 'list_exercises', arguments: { from: '2026-03-01', to: '2026-03-02' } },
      { 'x-api-key': TOKEN },
    );

    expect(res.status).toBe(200);
    const { result } = await body(res);
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual([]);
    expect(request).toHaveBeenCalled();
  });

  it('ツールが投げた例外は isError の結果になる', async () => {
    request.mockRejectedValue(new Error('ダミーの失敗'));

    const res = await rpc(
      'tools/call',
      { name: 'list_exercises', arguments: {} },
      { 'x-api-key': TOKEN },
    );

    expect(res.status).toBe(200);
    const { result } = await body(res);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('ダミーの失敗');
  });
});

describe('/mcp の subscriptions/listen', () => {
  useToken();

  // 2026-07-28 はリクエストごとに _meta のエンベロープと Mcp-Method ヘッダーを要求する
  const listen = () =>
    app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'subscriptions/listen',
        'x-api-key': TOKEN,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'subscriptions/listen',
        params: {
          notifications: { toolsListChanged: true },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });

  it('接続中に一覧は変わらないので listChanged を宣言しない', async () => {
    // 宣言するとクライアントが通知を購読しに来て、上記のストリームが開かれてしまう。
    // ツールを追加したときは再接続時に取り直されるので、これで困らない
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'server/discover',
        'x-api-key': TOKEN,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });

    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('"listChanged":false');
  });

  it('受け付けずに即座に応答を閉じる', async () => {
    const res = await listen();
    expect(res.status).toBe(200);

    // 受け付けるとストリームが開いたままになり、Vercel の実行上限 (300 秒) まで居座る。
    // 本文を読み切れる = 閉じている、をタイムアウト付きで確かめる
    const closed = await Promise.race([
      res.text(),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);

    expect(closed, 'ストリームが閉じずに開いたままになっている').not.toBeNull();
    expect(closed).toContain('Subscription limit reached');
  });

  it('想定どおりの拒否なので、エラーとして記録しない', async () => {
    // src/index.js の onerror は SDK の英語メッセージで拒否を見分けている。
    // 文言が変わるとログに出続けるだけで壊れないので、ここで落ちるようにしておく
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await (await listen()).text();
      expect(spy, `記録された内容: ${spy.mock.calls.join(' / ')}`).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('/mcp の serverInfo', () => {
  useToken();

  it('initialize の応答にアイコンが含まれる', async () => {
    const res = await initialize({ 'x-api-key': TOKEN });
    const text = await res.text();
    expect(text).toContain('"icons":[{"src":"data:image/png;base64,');
  });
});
