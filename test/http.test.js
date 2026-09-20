import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index.js';

const TOKEN = 'test-token-not-a-real-secret';

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
  beforeEach(() => {
    process.env.GHEALTH_MCP_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.GHEALTH_MCP_TOKEN;
  });

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

  it('環境変数が未設定なら、空のヘッダーでも 401 を返す', async () => {
    delete process.env.GHEALTH_MCP_TOKEN;
    const res = await initialize({ 'x-api-key': '' });
    expect(res.status).toBe(401);
  });

  it('x-api-key が正しければ initialize に応答する', async () => {
    const res = await initialize({ 'x-api-key': TOKEN });
    expect(res.status).toBe(200);
  });
});

describe('/mcp のツール', () => {
  beforeEach(() => {
    process.env.GHEALTH_MCP_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.GHEALTH_MCP_TOKEN;
  });

  it('ping ツールが tools/list に載り、呼び出すと pong を返す', async () => {
    const headers = { 'x-api-key': TOKEN };

    const list = await rpc('tools/list', {}, headers);
    expect(list.status).toBe(200);
    expect(await list.text()).toContain('"ping"');

    const call = await rpc('tools/call', { name: 'ping', arguments: {} }, headers);
    expect(call.status).toBe(200);
    expect(await call.text()).toContain('pong');
  });
});
