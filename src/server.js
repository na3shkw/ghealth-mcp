#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getExercise, listExercises } from './health.js';

const server = new McpServer({ name: 'ghealth', version: '1.0.0' });

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({
  content: [{ type: 'text', text: `エラー: ${e.message}` }],
  isError: true,
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定してください');

server.registerTool(
  'list_exercises',
  {
    title: '運動一覧',
    description:
      'Google Health に記録された運動を新しい順に一覧する。距離・時間・ペース・心拍などは変換済みの値を返す。',
    inputSchema: {
      from: isoDate.optional().describe('開始日 (ローカル日付)。省略時は to の 30 日前'),
      to: isoDate.optional().describe('終了日 (ローカル日付, この日を含む)。省略時は今日'),
      limit: z.number().int().positive().max(200).optional().describe('最大件数。既定 20'),
    },
  },
  async (args) => {
    try {
      return json(await listExercises(args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'get_exercise',
  {
    title: '運動の詳細',
    description:
      '運動 1 件の詳細を返す。ラップ、歩数、ピッチ、ストライド、心拍ゾーンなどを含む。id は list_exercises が返す値。',
    inputSchema: {
      id: z.string().min(1).describe('運動の識別子'),
    },
  },
  async ({ id }) => {
    try {
      return json(await getExercise(id));
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
