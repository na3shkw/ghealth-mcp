import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dataPointWithId,
  restingHeartRateDataPoint,
  restingHeartRateOn,
  runningDataPoint,
  sleepStartingAt,
} from './fixtures.js';

const request = vi.fn();
vi.mock('../src/auth-client.js', () => ({ createAuthClient: () => ({ request }) }));

const { getExercise, listExercises, listRestingHeartRate, listSleep } =
  await import('../src/health.js');

/** 呼び出し n 回目のリクエスト URL を URL オブジェクトで返す */
const urlOf = (n = 0) => new URL(request.mock.calls[n][0].url);

beforeEach(() => {
  request.mockReset();
});

describe('listExercises', () => {
  it('civil_start_time で期間を絞る', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listExercises({ from: '2026-08-01', to: '2026-08-25' });

    expect(urlOf().searchParams.get('filter')).toBe(
      'exercise.interval.civil_start_time>="2026-08-01T00:00:00" AND ' +
        'exercise.interval.civil_start_time<"2026-08-26T00:00:00"',
    );
  });

  it('to をその日ごと含める（翌日 0 時未満で切る）', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listExercises({ from: '2026-08-25', to: '2026-08-25' });

    expect(urlOf().searchParams.get('filter')).toContain('<"2026-08-26T00:00:00"');
  });

  it('月をまたぐ to を正しく繰り上げる', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listExercises({ to: '2026-08-31' });

    expect(urlOf().searchParams.get('filter')).toContain('<"2026-09-01T00:00:00"');
  });

  it('exercise 名前空間付きのパスを使う（プレフィックスなしは API が受け付けない）', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listExercises({});

    const filter = urlOf().searchParams.get('filter');
    expect(filter).toMatch(/^exercise\.interval\.civil_start_time/);
  });

  it('exercise データ型のエンドポイントを叩く', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listExercises({});

    expect(urlOf().pathname).toBe('/v4/users/me/dataTypes/exercise/dataPoints');
  });

  describe('既定の期間', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-25T12:00:00Z'));
      request.mockResolvedValue({ data: { dataPoints: [] } });
    });
    afterEach(() => vi.useRealTimers());

    it('to 省略時は今日', async () => {
      await listExercises({});
      expect(urlOf().searchParams.get('filter')).toContain('<"2026-08-26T00:00:00"');
    });

    it('from 省略時は to の 30 日前', async () => {
      await listExercises({});
      expect(urlOf().searchParams.get('filter')).toContain('>="2026-07-26T00:00:00"');
    });

    it('to だけ指定すればその 30 日前から', async () => {
      await listExercises({ to: '2026-03-05' });
      expect(urlOf().searchParams.get('filter')).toContain('>="2026-02-03T00:00:00"');
    });

    it('引数なしでも呼べる', async () => {
      await expect(listExercises()).resolves.toEqual([]);
    });
  });

  describe('ページング', () => {
    it('nextPageToken を辿って結果を連結する', async () => {
      request
        .mockResolvedValueOnce({
          data: { dataPoints: [dataPointWithId('a')], nextPageToken: '2' },
        })
        .mockResolvedValueOnce({
          data: { dataPoints: [dataPointWithId('b')], nextPageToken: '3' },
        })
        .mockResolvedValueOnce({ data: { dataPoints: [dataPointWithId('c')] } });

      const result = await listExercises({ limit: 10 });

      expect(request).toHaveBeenCalledTimes(3);
      expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('2 ページ目以降は pageToken を送る', async () => {
      request
        .mockResolvedValueOnce({
          data: { dataPoints: [dataPointWithId('a')], nextPageToken: 'TOKEN' },
        })
        .mockResolvedValueOnce({ data: { dataPoints: [] } });

      await listExercises({ limit: 10 });

      expect(urlOf(0).searchParams.has('pageToken')).toBe(false);
      expect(urlOf(1).searchParams.get('pageToken')).toBe('TOKEN');
    });

    it('limit に達したら追加のページを取りに行かない', async () => {
      request.mockResolvedValue({
        data: { dataPoints: [dataPointWithId('a'), dataPointWithId('b')], nextPageToken: '2' },
      });

      const result = await listExercises({ limit: 2 });

      expect(request).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
    });

    it('ページ途中で limit に達したら切り捨てる', async () => {
      request.mockResolvedValue({
        data: {
          dataPoints: [dataPointWithId('a'), dataPointWithId('b'), dataPointWithId('c')],
          nextPageToken: '2',
        },
      });

      expect(await listExercises({ limit: 2 })).toHaveLength(2);
    });

    it('limit 既定は 20', async () => {
      const page = Array.from({ length: 50 }, (_, i) => dataPointWithId(`x${i}`));
      request.mockResolvedValue({ data: { dataPoints: page, nextPageToken: '2' } });

      expect(await listExercises({})).toHaveLength(20);
    });

    it('dataPoints が欠けたレスポンスでも落ちない', async () => {
      request.mockResolvedValue({ data: {} });
      expect(await listExercises({})).toEqual([]);
    });
  });

  it('要約された項目だけを返す', async () => {
    request.mockResolvedValue({ data: { dataPoints: [runningDataPoint] } });

    const [item] = await listExercises({});

    expect(Object.keys(item).sort()).toEqual(
      [
        'avgHeartRate',
        'calories',
        'displayName',
        'distanceKm',
        'duration',
        'exerciseType',
        'hasGps',
        'id',
        'localDate',
        'pacePerKm',
      ].sort(),
    );
  });

  it('API のエラーはそのまま伝播させる', async () => {
    request.mockRejectedValue(new Error('Invalid data point filter'));
    await expect(listExercises({})).rejects.toThrow('Invalid data point filter');
  });
});

describe('getExercise', () => {
  it('id を指定して単一データポイントを取得する', async () => {
    request.mockResolvedValue({ data: runningDataPoint });

    await getExercise('1111111111');

    expect(urlOf().pathname).toBe(
      '/v4/users/me/dataTypes/exercise/dataPoints/1111111111',
    );
  });

  it('id をエスケープする', async () => {
    request.mockResolvedValue({ data: runningDataPoint });

    await getExercise('a/../b');

    expect(request.mock.calls[0][0].url).toContain('dataPoints/a%2F..%2Fb');
  });

  it('詳細項目を含む', async () => {
    request.mockResolvedValue({ data: runningDataPoint });

    const d = await getExercise('1111111111');

    expect(d.splits).toHaveLength(2);
    expect(d.steps).toBe(6000);
    expect(d.heartRateZones.vigorous).toBe(30);
  });

  it('存在しない id のエラーを伝播させる', async () => {
    request.mockRejectedValue(new Error('The requested resource was not found.'));
    await expect(getExercise('999')).rejects.toThrow('not found');
  });
});

describe('listRestingHeartRate', () => {
  it('daily-resting-heart-rate のエンドポイントを叩く', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listRestingHeartRate({});

    expect(urlOf().pathname).toBe('/v4/users/me/dataTypes/daily-resting-heart-rate/dataPoints');
  });

  it('date で期間を絞る（to を含めるため翌日未満で切る）', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listRestingHeartRate({ from: '2026-08-01', to: '2026-08-25' });

    expect(urlOf().searchParams.get('filter')).toBe(
      'daily_resting_heart_rate.date>="2026-08-01" AND daily_resting_heart_rate.date<"2026-08-26"',
    );
  });

  describe('既定の期間', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-25T12:00:00Z'));
      request.mockResolvedValue({ data: { dataPoints: [] } });
    });
    afterEach(() => vi.useRealTimers());

    it('省略時は今日までの 30 日間', async () => {
      await listRestingHeartRate();

      expect(urlOf().searchParams.get('filter')).toBe(
        'daily_resting_heart_rate.date>="2026-07-26" AND daily_resting_heart_rate.date<"2026-08-26"',
      );
    });
  });

  it('localDate と bpm だけを返す', async () => {
    request.mockResolvedValue({ data: { dataPoints: [restingHeartRateDataPoint] } });

    expect(await listRestingHeartRate({})).toEqual([{ localDate: '2026-03-01', bpm: 55 }]);
  });

  it('日付の昇順に並べ替える', async () => {
    request.mockResolvedValue({
      data: {
        dataPoints: [
          restingHeartRateOn(2026, 8, 10, 55),
          restingHeartRateOn(2026, 8, 2, 51),
          restingHeartRateOn(2026, 12, 1, 50),
        ],
      },
    });

    expect((await listRestingHeartRate({})).map((r) => r.localDate)).toEqual([
      '2026-08-02',
      '2026-08-10',
      '2026-12-01',
    ]);
  });

  it('nextPageToken を辿って全ページ取得する', async () => {
    request
      .mockResolvedValueOnce({
        data: { dataPoints: [restingHeartRateOn(2026, 8, 1, 50)], nextPageToken: 'TOKEN' },
      })
      .mockResolvedValueOnce({ data: { dataPoints: [restingHeartRateOn(2026, 8, 2, 51)] } });

    const result = await listRestingHeartRate({});

    expect(urlOf(1).searchParams.get('pageToken')).toBe('TOKEN');
    expect(result.map((r) => r.bpm)).toEqual([50, 51]);
  });

  it('dataPoints が欠けたレスポンスでも落ちない', async () => {
    request.mockResolvedValue({ data: {} });
    expect(await listRestingHeartRate({})).toEqual([]);
  });
});

describe('listSleep', () => {
  it('sleep のエンドポイントを叩く', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listSleep({});

    expect(urlOf().pathname).toBe('/v4/users/me/dataTypes/sleep/dataPoints');
  });

  it('civil_end_time で期間を絞る（start 側は API が受け付けない）', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listSleep({ from: '2026-08-01', to: '2026-08-25' });

    expect(urlOf().searchParams.get('filter')).toBe(
      'sleep.interval.civil_end_time>="2026-08-01T00:00:00" AND ' +
        'sleep.interval.civil_end_time<"2026-08-26T00:00:00"',
    );
  });

  it('pageSize は sleep の上限 25', async () => {
    request.mockResolvedValue({ data: { dataPoints: [] } });
    await listSleep({});

    expect(urlOf().searchParams.get('pageSize')).toBe('25');
  });

  describe('既定の期間', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-25T12:00:00Z'));
      request.mockResolvedValue({ data: { dataPoints: [] } });
    });
    afterEach(() => vi.useRealTimers());

    it('省略時は今日までの 30 日間', async () => {
      await listSleep();

      expect(urlOf().searchParams.get('filter')).toBe(
        'sleep.interval.civil_end_time>="2026-07-26T00:00:00" AND ' +
          'sleep.interval.civil_end_time<"2026-08-26T00:00:00"',
      );
    });
  });

  it('就寝時刻の昇順に並べ替える', async () => {
    request.mockResolvedValue({
      data: {
        dataPoints: [
          sleepStartingAt('2026-08-26T14:00:00Z', 'c'),
          sleepStartingAt('2026-08-24T14:00:00Z', 'a'),
          sleepStartingAt('2026-08-25T14:00:00Z', 'b'),
        ],
      },
    });

    expect((await listSleep({})).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('nextPageToken を辿って全ページ取得する', async () => {
    request
      .mockResolvedValueOnce({
        data: {
          dataPoints: [sleepStartingAt('2026-08-24T14:00:00Z', 'a')],
          nextPageToken: 'TOKEN',
        },
      })
      .mockResolvedValueOnce({
        data: { dataPoints: [sleepStartingAt('2026-08-25T14:00:00Z', 'b')] },
      });

    const result = await listSleep({});

    expect(urlOf(1).searchParams.get('pageToken')).toBe('TOKEN');
    expect(result.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('dataPoints が欠けたレスポンスでも落ちない', async () => {
    request.mockResolvedValue({ data: {} });
    expect(await listSleep({})).toEqual([]);
  });

  it('スコープ不足のエラーはそのまま伝播させる', async () => {
    request.mockRejectedValue(new Error('Required OAuth scope(s) are missing for this operation.'));
    await expect(listSleep({})).rejects.toThrow('Required OAuth scope');
  });
});
