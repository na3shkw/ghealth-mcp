import { describe, expect, it } from 'vitest';
import {
  detail,
  formatDuration,
  formatPace,
  num,
  parseSeconds,
  restingHeartRate,
  summarize,
  toIsoDay,
  toLocalDate,
} from '../src/health.js';
import { restingHeartRateDataPoint, runningDataPoint, sparseDataPoint } from './fixtures.js';

describe('parseSeconds', () => {
  it('末尾の s を落として数値にする', () => {
    expect(parseSeconds('2400s')).toBe(2400);
    expect(parseSeconds('0.3s')).toBe(0.3);
    expect(parseSeconds('480s')).toBe(480);
    expect(parseSeconds('0s')).toBe(0);
  });

  it('値がなければ undefined', () => {
    expect(parseSeconds(undefined)).toBeUndefined();
    expect(parseSeconds(null)).toBeUndefined();
    expect(parseSeconds('abc')).toBeUndefined();
    expect(parseSeconds('')).toBeUndefined();
    expect(parseSeconds('s')).toBeUndefined();
  });
});

describe('num', () => {
  it('文字列で来る整数を number にする', () => {
    expect(num('6000')).toBe(6000);
    expect(num('150')).toBe(150);
    expect(num(400)).toBe(400);
  });

  it('0 を落とさない', () => {
    expect(num('0')).toBe(0);
    expect(num(0)).toBe(0);
  });

  it('値がなければ undefined', () => {
    expect(num(undefined)).toBeUndefined();
    expect(num(null)).toBeUndefined();
    expect(num('')).toBeUndefined();
  });
});

describe('formatDuration', () => {
  it('1 時間未満は MM:SS', () => {
    expect(formatDuration(2400)).toBe('40:00');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('1 時間以上は H:MM:SS で分をゼロ詰めする', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(7325)).toBe('2:02:05');
  });

  it('秒は四捨五入する', () => {
    expect(formatDuration(480)).toBe('8:00');
    expect(formatDuration(59.6)).toBe('1:00');
  });

  it('値がなければ undefined', () => {
    expect(formatDuration(undefined)).toBeUndefined();
    expect(formatDuration(null)).toBeUndefined();
  });
});

describe('formatPace', () => {
  it('秒/m を M:SS/km に変換する', () => {
    expect(formatPace(0.49)).toBe('8:10/km');
    expect(formatPace(0.48)).toBe('8:00/km');
    expect(formatPace(0.3)).toBe('5:00/km');
  });

  it('10 分/km を超えても分は桁を詰めない', () => {
    expect(formatPace(1.2521)).toBe('20:52/km');
  });

  it('値がなければ undefined', () => {
    expect(formatPace(undefined)).toBeUndefined();
    expect(formatPace(null)).toBeUndefined();
  });
});

describe('toLocalDate', () => {
  it('UTC 時刻にオフセットを足す', () => {
    expect(toLocalDate('2026-03-10T09:45:00.000Z', '32400s')).toBe('2026-03-10T18:45:00+09:00');
  });

  it('UTC のままだと日付がずれる早朝のランを正しく扱う', () => {
    // UTC では 8/24 だがローカル(+09:00)では 8/25 未明
    expect(toLocalDate('2026-08-24T21:30:00Z', '32400s')).toBe('2026-08-25T06:30:00+09:00');
  });

  it('負のオフセットで前日に戻る', () => {
    expect(toLocalDate('2026-08-25T02:00:00Z', '-18000s')).toBe('2026-08-24T21:00:00-05:00');
  });

  it('30 分単位のオフセットを扱う', () => {
    expect(toLocalDate('2026-08-25T00:00:00Z', '19800s')).toBe('2026-08-25T05:30:00+05:30');
  });

  it('オフセットがなければ UTC 扱い', () => {
    expect(toLocalDate('2026-03-10T09:45:00Z', undefined)).toBe('2026-03-10T09:45:00+00:00');
  });

  it('開始時刻がなければ undefined', () => {
    expect(toLocalDate(undefined, '32400s')).toBeUndefined();
  });
});

describe('summarize', () => {
  const s = summarize(runningDataPoint);

  it('name の末尾を id にする', () => {
    expect(s.id).toBe('1111111111');
  });

  it('単位変換済みの値を返す', () => {
    expect(s).toMatchObject({
      localDate: '2026-03-10T18:45:00+09:00',
      exerciseType: 'RUNNING',
      displayName: 'ジョギング',
      distanceKm: 5,
      duration: '40:00',
      pacePerKm: '8:10/km',
      avgHeartRate: 150,
      calories: 400,
      hasGps: true,
    });
  });

  it('生の値は返さない', () => {
    expect(s).not.toHaveProperty('distanceMillimeters');
    expect(s).not.toHaveProperty('averagePaceSecondsPerMeter');
  });

  it('メトリクスが欠けていても落ちない', () => {
    expect(summarize(sparseDataPoint)).toMatchObject({
      id: '2222222222',
      exerciseType: 'WALKING',
      duration: '30:00',
      hasGps: false,
    });
  });
});

describe('detail', () => {
  const d = detail(runningDataPoint);

  it('summarize の全項目を含む', () => {
    expect(d).toMatchObject(summarize(runningDataPoint));
  });

  it('DISTANCE のラップを 1 始まりの index で返す', () => {
    expect(d.splits).toEqual([
      { index: 1, distanceKm: 1, duration: '8:00', pacePerKm: '8:00/km' },
      { index: 2, distanceKm: 0.5, duration: '4:35', pacePerKm: '9:10/km' },
    ]);
  });

  it('ランニングダイナミクスを変換する', () => {
    expect(d).toMatchObject({
      steps: 6000,
      cadence: 150,
      strideLengthCm: 80,
      verticalOscillationCm: 9,
      verticalRatio: 11.05,
      groundContactTimeMs: 300,
      elevationGainM: 30,
      activeZoneMinutes: 60,
    });
  });

  it('心拍ゾーンを分に変換する', () => {
    expect(d.heartRateZones).toEqual({ light: 0, moderate: 5, vigorous: 30, peak: 0 });
  });

  it('DISTANCE 以外のラップは除外する', () => {
    const dp = structuredClone(runningDataPoint);
    dp.exercise.splits.push({ splitType: 'TIME', activeDuration: '60s', metricsSummary: {} });
    expect(detail(dp).splits).toHaveLength(2);
  });

  it('メトリクスが欠けていても落ちない', () => {
    const d2 = detail(sparseDataPoint);
    expect(d2.splits).toEqual([]);
    expect(d2.steps).toBeUndefined();
    expect(d2.heartRateZones).toEqual({
      light: undefined,
      moderate: undefined,
      vigorous: undefined,
      peak: undefined,
    });
  });
});

describe('toIsoDay', () => {
  it('年月日を YYYY-MM-DD に組む', () => {
    expect(toIsoDay({ year: 2026, month: 3, day: 1 })).toBe('2026-03-01');
  });

  it('月日をゼロ埋めする', () => {
    expect(toIsoDay({ year: 2026, month: 12, day: 31 })).toBe('2026-12-31');
  });

  it('欠けていれば undefined', () => {
    expect(toIsoDay(undefined)).toBeUndefined();
    expect(toIsoDay({})).toBeUndefined();
    expect(toIsoDay({ year: 2026, month: 8 })).toBeUndefined();
  });
});

describe('restingHeartRate', () => {
  it('文字列の beatsPerMinute を数値にする', () => {
    expect(restingHeartRate(restingHeartRateDataPoint)).toEqual({
      localDate: '2026-03-01',
      bpm: 55,
    });
  });

  it('値が欠けていても落ちない', () => {
    expect(restingHeartRate({})).toEqual({ localDate: undefined, bpm: undefined });
  });
});
