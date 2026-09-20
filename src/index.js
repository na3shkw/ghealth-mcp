import { Hono } from 'hono';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer } from './mcp-server.js';
import { apiKeyAuth } from './api-key.js';

// createMcpHandler はリクエストごとに createServer を呼ぶステートレス構成
const mcp = createMcpHandler(createServer, {
  // subscriptions/listen は通知を受け取るための長時間ストリームで、クライアントが
  // 繋いでいる間ずっと開いたままになる。サーバーレスでは関数の実行上限 (300 秒) まで
  // 居座り続け、タイムアウトエラーと実行時間の浪費になるので受け付けない。
  // このサーバーはツール一覧が固定で通知を送らないため、失うものはない。
  maxSubscriptions: 0,
  onerror: (e) => console.error(`[mcp] ハンドラー外のエラー: ${e.message}`),
});

const app = new Hono();
app.use('/mcp', apiKeyAuth());
app.all('/mcp', (c) => mcp.fetch(c.req.raw));

export default app;
