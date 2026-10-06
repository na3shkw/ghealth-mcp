import { describe, expect, it } from 'vitest';
import {
  detail,
  exerciseMinutes,
  intervalSeconds,
  formatDuration,
  formatPace,
  num,
  parseSeconds,
  heartRateVariability,
  restingHeartRate,
  sleepOnsetMinutes,
  sleepSession,
  summarize,
  toIsoDay,
  toLocalDate,
} from '../src/health.js';
import {
  classicSleepDataPoint,
  distancePoint,
  exerciseWithEvents,
  heartRatePoint,
  phoneSource,
  hrvDataPoint,
  restingHeartRateDataPoint,
  runningDataPoint,
  sleepDataPoint,
  sparseDataPoint,
  stepsPoint,
} from './fixtures.js';

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

describe('heartRateVariability', () => {
  it('日付と平均・深い睡眠中の RMSSD を整数に丸めて返す', () => {
    expect(heartRateVariability(hrvDataPoint)).toEqual({
      localDate: '2026-03-01',
      avgRmssdMs: 41,
      deepSleepRmssdMs: 35,
    });
  });

  it('値が欠けていても落ちない', () => {
    expect(heartRateVariability({})).toEqual({
      localDate: undefined,
      avgRmssdMs: undefined,
      deepSleepRmssdMs: undefined,
    });
  });
});

describe('sleepSession', () => {
  it('就寝・起床のローカル時刻を組む', () => {
    const s = sleepSession(sleepDataPoint);

    expect(s.bedtime).toBe('2026-03-14T23:30:00+09:00');
    expect(s.wakeTime).toBe('2026-03-15T07:30:00+09:00');
  });

  it('日をまたぐため起床日を localDate にする', () => {
    expect(sleepSession(sleepDataPoint).localDate).toBe('2026-03-15');
  });

  it('床上時間と睡眠時間は summary の分数から整形する', () => {
    const s = sleepSession(sleepDataPoint);

    // interval の長さは 8:00:00。minutesInSleepPeriod の 450 分を使う
    expect(s.timeInBed).toBe('7:30:00');
    expect(s.timeAsleep).toBe('6:30:00');
  });

  it('睡眠効率は minutesAsleep / minutesInSleepPeriod', () => {
    // 390 / 450。interval の長さ (480 分) で割ると 81.3 になる
    expect(sleepSession(sleepDataPoint).efficiencyPercent).toBe(86.7);
  });

  it('ステージ別の分数を summary.stagesSummary から取る', () => {
    expect(sleepSession(sleepDataPoint).stageMinutes).toEqual({
      awake: 30,
      light: 210,
      deep: 70,
      rem: 110,
    });
  });

  it('覚醒の分数を数値で返す', () => {
    expect(sleepSession(sleepDataPoint).awakeMinutes).toBe(30);
  });

  it('常に 0 で来る minutesToFallAsleep は返さない', () => {
    expect(sleepSession(sleepDataPoint).minutesToFallAsleep).toBeUndefined();
  });

  it('入眠潜時を stages の先頭 AWAKE から出す', () => {
    expect(sleepSession(sleepDataPoint).sleepOnsetMinutes).toBe(15);
  });

  it('stages がない記録では入眠潜時を返さない', () => {
    expect(sleepSession(classicSleepDataPoint).sleepOnsetMinutes).toBeUndefined();
  });

  it('短時間覚醒は件数だけ返す', () => {
    expect(sleepSession(sleepDataPoint).shortAwakenings).toBe(7);
  });

  it('種別とメイン睡眠かどうかを返す', () => {
    const s = sleepSession(sleepDataPoint);

    expect(s.type).toBe('STAGES');
    expect(s.isMainSleep).toBe(true);
  });

  it('summary がない記録では床上時間を interval から出す', () => {
    const s = sleepSession(classicSleepDataPoint);

    expect(s.timeInBed).toBe('7:00:00');
    expect(s.timeAsleep).toBeUndefined();
    expect(s.efficiencyPercent).toBeUndefined();
    expect(s.stageMinutes).toBeUndefined();
    expect(s.type).toBe('CLASSIC');
  });

  it('id は name の末尾', () => {
    expect(sleepSession(sleepDataPoint).id).toBe('3333333333');
  });

  it('空の dataPoint でも落ちない', () => {
    expect(() => sleepSession({})).not.toThrow();
  });
});

describe('sleepOnsetMinutes', () => {
  const stage = (type, startTime, endTime) => ({ type, startTime, endTime });

  it('先頭に連続する AWAKE をすべて足す', () => {
    expect(
      sleepOnsetMinutes([
        stage('AWAKE', '2026-09-01T00:00:00Z', '2026-09-01T00:05:00Z'),
        stage('AWAKE', '2026-09-01T00:05:00Z', '2026-09-01T00:12:00Z'),
        stage('LIGHT', '2026-09-01T00:12:00Z', '2026-09-01T01:00:00Z'),
      ]),
    ).toBe(12);
  });

  it('AWAKE で始まらなければ 0', () => {
    expect(
      sleepOnsetMinutes([stage('LIGHT', '2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z')]),
    ).toBe(0);
  });

  it('夜中の AWAKE は潜時に含めない', () => {
    expect(
      sleepOnsetMinutes([
        stage('AWAKE', '2026-09-01T00:00:00Z', '2026-09-01T00:04:00Z'),
        stage('LIGHT', '2026-09-01T00:04:00Z', '2026-09-01T01:00:00Z'),
        stage('AWAKE', '2026-09-01T01:00:00Z', '2026-09-01T01:30:00Z'),
      ]),
    ).toBe(4);
  });

  it('並び順が崩れていても開始時刻で整列してから見る', () => {
    expect(
      sleepOnsetMinutes([
        stage('LIGHT', '2026-09-01T00:06:00Z', '2026-09-01T01:00:00Z'),
        stage('AWAKE', '2026-09-01T00:00:00Z', '2026-09-01T00:06:00Z'),
      ]),
    ).toBe(6);
  });

  it('30 秒刻みの区間は小数で返す', () => {
    expect(
      sleepOnsetMinutes([
        stage('AWAKE', '2026-09-01T00:00:00Z', '2026-09-01T00:03:30Z'),
        stage('LIGHT', '2026-09-01T00:03:30Z', '2026-09-01T01:00:00Z'),
      ]),
    ).toBe(3.5);
  });

  it('先頭 AWAKE の長さが取れなければ確定できない', () => {
    expect(sleepOnsetMinutes([stage('AWAKE', '2026-09-01T00:00:00Z', undefined)])).toBeUndefined();
  });

  it('stages がない・空なら undefined', () => {
    expect(sleepOnsetMinutes(undefined)).toBeUndefined();
    expect(sleepOnsetMinutes([])).toBeUndefined();
  });
});

describe('intervalSeconds', () => {
  it('開始と終了の差を秒で返す', () => {
    expect(
      intervalSeconds({ startTime: '2026-08-24T14:10:00Z', endTime: '2026-08-24T14:40:30Z' }),
    ).toBe(1830);
  });

  it('終了が欠けていれば undefined', () => {
    expect(intervalSeconds({ startTime: '2026-08-24T14:10:00Z' })).toBeUndefined();
  });

  it('interval そのものが欠けていても落ちない', () => {
    expect(intervalSeconds(undefined)).toBeUndefined();
  });
});

describe('exerciseMinutes', () => {
  const base = {
    startTime: '2026-03-10T09:00:30Z',
    endTime: '2026-03-10T09:02:30Z',
    utcOffsetSeconds: 32400,
  };

  it('開始を切り下げ終了を切り上げた窓の分をすべて返す', () => {
    const rows = exerciseMinutes(base);
    expect(rows.map((r) => r.time)).toEqual(['18:00', '18:01', '18:02']);
  });

  it('距離と歩数から換算値を組み立てる', () => {
    const [row] = exerciseMinutes({
      ...base,
      endTime: '2026-03-10T09:01:00Z',
      distancePoints: [distancePoint('2026-03-10T09:00:00Z', 150000)],
      stepsPoints: [stepsPoint('2026-03-10T09:00:00Z', 150)],
    });

    expect(row).toMatchObject({
      time: '18:00',
      distanceM: 150,
      steps: 150,
      // 60 秒区間なのでピッチは歩数と同値
      cadenceSpm: 150,
      paceSecPerKm: 400,
      strideCm: 100,
    });
  });

  it('レコードが無い分は距離・歩数を 0 で埋める', () => {
    const rows = exerciseMinutes({
      ...base,
      distancePoints: [distancePoint('2026-03-10T09:01:00Z', 100000)],
      stepsPoints: [stepsPoint('2026-03-10T09:01:00Z', 100)],
    });

    expect(rows[0]).toMatchObject({ distanceM: 0, steps: 0, cadenceSpm: 0 });
  });

  it('距離 0 のペースと歩数 0 のストライドは null にする', () => {
    const [row] = exerciseMinutes(base);
    expect(row.paceSecPerKm).toBeNull();
    expect(row.strideCm).toBeNull();
  });

  it('60 秒ちょうどでない区間は二重計上を避けて捨てる', () => {
    const rows = exerciseMinutes({
      ...base,
      distancePoints: [
        distancePoint('2026-03-10T09:00:00Z', 100000),
        distancePoint('2026-03-10T09:00:00Z', 90000, { endTime: '2026-03-10T09:00:20Z' }),
      ],
      stepsPoints: [
        stepsPoint('2026-03-10T09:00:00Z', 100),
        stepsPoint('2026-03-10T09:00:00Z', 90, { endTime: '2026-03-10T09:09:38Z' }),
      ],
    });

    expect(rows[0]).toMatchObject({ distanceM: 100, steps: 100 });
  });

  it('dataSource.device が無い区間は二重計上を避けて捨てる', () => {
    const rows = exerciseMinutes({
      ...base,
      distancePoints: [
        distancePoint('2026-03-10T09:00:00Z', 100000),
        distancePoint('2026-03-10T09:00:00Z', 90000, { source: phoneSource }),
      ],
      stepsPoints: [
        stepsPoint('2026-03-10T09:00:00Z', 100),
        stepsPoint('2026-03-10T09:00:00Z', 90, { source: phoneSource }),
      ],
    });

    expect(rows[0]).toMatchObject({ distanceM: 100, steps: 100 });
  });

  it('心拍サンプルを分のバケットに振り分けて集計する', () => {
    const rows = exerciseMinutes({
      ...base,
      heartRatePoints: [
        heartRatePoint('2026-03-10T09:00:05Z', 140),
        heartRatePoint('2026-03-10T09:00:55Z', 150),
        heartRatePoint('2026-03-10T09:01:05Z', 160),
      ],
    });

    expect(rows[0]).toMatchObject({ avgBpm: 145, maxBpm: 150, minBpm: 140 });
    expect(rows[1]).toMatchObject({ avgBpm: 160, maxBpm: 160, minBpm: 160 });
  });

  it('心拍サンプルが無い分は 0 で埋めず null にする', () => {
    const [row] = exerciseMinutes(base);
    expect(row.avgBpm).toBeNull();
    expect(row.maxBpm).toBeNull();
    expect(row.minBpm).toBeNull();
  });

  it('時刻が壊れていれば空配列を返す', () => {
    expect(exerciseMinutes({ startTime: undefined, endTime: undefined })).toEqual([]);
  });
});

describe('detail の exerciseEvents', () => {
  it('開始・停止イベントをローカル時刻で通す', () => {
    expect(detail(exerciseWithEvents).events).toEqual([
      { type: 'START', time: '2026-03-10T18:45:00+09:00' },
      { type: 'STOP', time: '2026-03-10T19:25:00+09:00' },
    ]);
  });

  it('イベントが無ければキーごと省く', () => {
    expect(detail(runningDataPoint).events).toBeUndefined();
  });
});
