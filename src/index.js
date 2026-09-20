import { Hono } from 'hono';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { apiKeyAuth } from './api-key.js';

/** リクエストごとに呼ばれる。疎通確認用のダミーツールだけを持つ */
const createServer = () => {
  const server = new McpServer({ name: 'ghealth', version: '1.0.0' });
  server.registerTool(
    'ping',
    { title: '疎通確認', description: '接続確認用。常に pong を返す。' },
    async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  );
  return server;
};

const mcp = createMcpHandler(createServer);

const app = new Hono();
app.use('/mcp', apiKeyAuth());
app.all('/mcp', (c) => mcp.fetch(c.req.raw));

export default app;
