import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  getExercise,
  getExerciseMinutes,
  listExercises,
  listRestingHeartRate,
  listSleep,
} from './health.js';

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({
  content: [{ type: 'text', text: `エラー: ${e.message}` }],
  isError: true,
});

/** ツール本体の例外を isError の結果に畳む。全ツールで同じ扱いにする */
const guard = (fn) => async (args) => {
  try {
    return json(await fn(args));
  } catch (e) {
    return fail(e);
  }
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定してください');

/**
 * ツールを登録済みの McpServer を新しく作る。
 * stdio 版 (src/server.js) と HTTP 版 (src/index.js) の両方から使う。
 * HTTP 版はリクエストごとにこれを呼ぶステートレス構成なので、
 * インスタンス間で状態を共有しないこと。
 */
export function createServer() {
  const server = new McpServer({ name: 'ghealth', version: '1.0.0' });

  server.registerTool(
    'list_exercises',
    {
      title: '運動一覧',
      description:
        'Google Health に記録された運動を新しい順に一覧する。距離・時間・ペース・心拍などは変換済みの値を返す。',
      inputSchema: z.object({
        from: isoDate.optional().describe('開始日 (ローカル日付)。省略時は to の 30 日前'),
        to: isoDate.optional().describe('終了日 (ローカル日付, この日を含む)。省略時は今日'),
        limit: z.number().int().positive().max(200).optional().describe('最大件数。既定 20'),
      }),
    },
    guard((args) => listExercises(args)),
  );

  server.registerTool(
    'get_exercise',
    {
      title: '運動の詳細',
      description:
        '運動 1 件の詳細を返す。ラップ、歩数、ピッチ、ストライド、心拍ゾーンなどを含む。id は list_exercises が返す値。',
      inputSchema: z.object({
        id: z.string().min(1).describe('運動の識別子'),
      }),
    },
    guard(({ id }) => getExercise(id)),
  );

  server.registerTool(
    'get_exercise_minutes',
    {
      title: '運動の 1 分ごとの内訳',
      description:
        '運動 1 件を 1 分ごとに分解して返す。id は list_exercises / get_exercise が返す値。'
        + 'get_exercise の平均ピッチや平均ペースは停止していた時間も均してしまうため、'
        + '信号待ちと低速走行を見分けたいときはこちらを使う。'
        + '距離・歩数は時計が記録した 60 秒区間のみを採用し、記録が無い分は 0 で埋める。'
        + '心拍サンプルが無い分の avgBpm / maxBpm / minBpm は null で、0 ではない。'
        + '停止判定やフェーズ分割はしていないので、解析は呼び出し側で行う。',
      inputSchema: z.object({
        id: z.string().min(1).describe('運動の識別子'),
      }),
    },
    guard(({ id }) => getExerciseMinutes(id)),
  );

  server.registerTool(
    'get_resting_heart_rate',
    {
      title: '安静時心拍数',
      description:
        '日ごとの安静時心拍数を日付の昇順で返す。心拍ゾーンの基準になる予備心拍数 (最大心拍数 − 安静時心拍数) の算出に使う。',
      inputSchema: z.object({
        from: isoDate.optional().describe('開始日 (ローカル日付)。省略時は to の 30 日前'),
        to: isoDate.optional().describe('終了日 (ローカル日付, この日を含む)。省略時は今日'),
      }),
    },
    guard((args) => listRestingHeartRate(args)),
  );

  server.registerTool(
    'get_sleep',
    {
      title: '睡眠',
      description:
        '睡眠セッションを就寝時刻の昇順で返す。就寝・起床時刻、床上時間、睡眠時間、睡眠効率、ステージ別の分数を含む。'
        + 'sleepOnsetMinutes は入眠までにかかった分数で、セッション冒頭の AWAKE 区間から算出する。'
        + '布団に入ってからではなくデバイスが睡眠を検出してからが起点なので、体感の寝付きの悪さより短く出る。'
        + '就寝は日をまたぐため、期間の指定も localDate も起床日が基準。',
      inputSchema: z.object({
        from: isoDate.optional().describe('開始日 (起床日のローカル日付)。省略時は to の 30 日前'),
        to: isoDate.optional().describe('終了日 (起床日のローカル日付, この日を含む)。省略時は今日'),
      }),
    },
    guard((args) => listSleep(args)),
  );

  return server;
}
