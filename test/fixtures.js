/** RUNNING の 1 件。実 API のレスポンス構造に合わせたダミー値 */
export const runningDataPoint = {
  name: 'users/1234567890/dataTypes/exercise/dataPoints/1111111111',
  exercise: {
    interval: {
      startTime: '2026-03-10T09:45:00.000Z',
      startUtcOffset: '32400s',
      endTime: '2026-03-10T10:25:00.000Z',
      endUtcOffset: '32400s',
    },
    exerciseType: 'RUNNING',
    splits: [
      {
        activeDuration: '480s',
        metricsSummary: { distanceMillimeters: 1000000, averagePaceSecondsPerMeter: 0.48 },
        splitType: 'DISTANCE',
      },
      {
        activeDuration: '275s',
        metricsSummary: {
          distanceMillimeters: 500000,
          averagePaceSecondsPerMeter: 0.55,
        },
        splitType: 'DISTANCE',
      },
    ],
    metricsSummary: {
      caloriesKcal: 400,
      distanceMillimeters: 5000000,
      steps: '6000',
      averagePaceSecondsPerMeter: 0.49,
      averageHeartRateBeatsPerMinute: '150',
      elevationGainMillimeters: 30000,
      activeZoneMinutes: '60',
      heartRateZoneDurations: {
        lightTime: '0s',
        moderateTime: '300s',
        vigorousTime: '1800s',
        peakTime: '0s',
      },
      mobilityMetrics: {
        avgCadenceStepsPerMinute: 150,
        avgStrideLengthMillimeters: '800',
        avgVerticalOscillationMillimeters: '90',
        avgVerticalRatio: 11.05,
        avgGroundContactTimeDuration: '0.3s',
      },
    },
    exerciseMetadata: { hasGps: true },
    displayName: 'ジョギング',
    activeDuration: '2400s',
  },
};

/** メトリクスの大半が欠けている記録（歩行など）を模したもの */
export const sparseDataPoint = {
  name: 'users/1234567890/dataTypes/exercise/dataPoints/2222222222',
  exercise: {
    interval: { startTime: '2026-03-05T09:40:00Z', startUtcOffset: '32400s' },
    exerciseType: 'WALKING',
    displayName: 'ウォーキング',
    activeDuration: '1800s',
    metricsSummary: {},
  },
};

export const dataPointWithId = (id) => ({
  ...sparseDataPoint,
  name: `users/1234567890/dataTypes/exercise/dataPoints/${id}`,
});

/** 安静時心拍数の 1 日分。beatsPerMinute は int64 なので文字列で来る */
export const restingHeartRateDataPoint = {
  name: 'users/1234567890/dataTypes/daily-resting-heart-rate/dataPoints/1',
  dailyRestingHeartRate: {
    date: { year: 2026, month: 3, day: 1 },
    dailyRestingHeartRateMetadata: { calculationMethod: 'WITH_SLEEP' },
    beatsPerMinute: '55',
  },
};

export const restingHeartRateOn = (year, month, day, bpm) => ({
  ...restingHeartRateDataPoint,
  dailyRestingHeartRate: {
    ...restingHeartRateDataPoint.dailyRestingHeartRate,
    date: { year, month, day },
    beatsPerMinute: String(bpm),
  },
});

/** 心拍変動の 1 日分。RMSSD は double なので数値で来る */
export const hrvDataPoint = {
  dataSource: { recordingMethod: 'DERIVED', device: { displayName: 'Watch' }, platform: 'FITBIT' },
  dailyHeartRateVariability: {
    date: { year: 2026, month: 3, day: 1 },
    averageHeartRateVariabilityMilliseconds: 40.5,
    nonRemHeartRateBeatsPerMinute: '50',
    entropy: 3,
    deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 35.25,
  },
};

export const hrvOn = (year, month, day, avg) => ({
  ...hrvDataPoint,
  dailyHeartRateVariability: {
    ...hrvDataPoint.dailyHeartRateVariability,
    date: { year, month, day },
    averageHeartRateVariabilityMilliseconds: avg,
  },
});

/**
 * ステージ付きの睡眠 1 件。実 API のレスポンス構造に合わせたダミー値。
 * stages と shortAwakenings は実レスポンスと同じ件数だけ並べてある。
 * 就寝 23:30〜翌 07:30 (JST) で日をまたぐ。分は int64 なので文字列で来る。
 */
export const sleepDataPoint = {
  name: 'users/1234567890/dataTypes/sleep/dataPoints/3333333333',
  dataSource: {
    recordingMethod: 'DERIVED',
    device: { displayName: 'Smart Watch' },
    platform: 'FITBIT',
  },
  sleep: {
    interval: {
      startTime: '2026-03-14T14:30:00Z',
      startUtcOffset: '32400s',
      endTime: '2026-03-14T22:30:00Z',
      endUtcOffset: '32400s',
    },
    type: 'STAGES',
    stages: [
      {
        startTime: '2026-03-14T14:30:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T14:45:00Z',
        endUtcOffset: '32400s',
        type: 'AWAKE',
      },
      {
        startTime: '2026-03-14T15:45:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T16:30:00Z',
        endUtcOffset: '32400s',
        type: 'LIGHT',
      },
      {
        startTime: '2026-03-14T16:30:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T17:00:00Z',
        endUtcOffset: '32400s',
        type: 'DEEP',
      },
      {
        startTime: '2026-03-14T17:15:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T17:50:00Z',
        endUtcOffset: '32400s',
        type: 'REM',
      },
      {
        startTime: '2026-03-14T22:15:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T22:30:00Z',
        endUtcOffset: '32400s',
        type: 'AWAKE',
      },
    ],
    metadata: { stagesStatus: 'SUCCEEDED', processed: true, mainSleep: true },
    summary: {
      // interval の長さ (8h) とはわざと食い違わせてある。実 API の
      // minutesInSleepPeriod は minutesAfterWakeUp を含まないため一致しない
      minutesInSleepPeriod: '450',
      minutesAfterWakeUp: '30',
      minutesToFallAsleep: '0',
      minutesAsleep: '390',
      minutesAwake: '30',
      stagesSummary: [
        { type: 'AWAKE', minutes: '30', count: '2' },
        { type: 'LIGHT', minutes: '210', count: '11' },
        { type: 'DEEP', minutes: '70', count: '5' },
        { type: 'REM', minutes: '110', count: '5' },
      ],
    },
    createTime: '2026-03-14T22:00:00.000000Z',
    updateTime: '2026-03-14T22:30:00.000000Z',
    shortAwakenings: [
      {
        startTime: '2026-03-14T17:20:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T17:21:00Z',
        endUtcOffset: '32400s',
        type: 'AWAKE',
      },
      {
        startTime: '2026-03-14T19:00:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T19:01:00Z',
        endUtcOffset: '32400s',
        type: 'AWAKE',
      },
      {
        startTime: '2026-03-14T19:30:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T19:30:30Z',
        endUtcOffset: '32400s',
        type: 'AWAKE',
      },
      {
        startTime: '2026-03-14T20:00:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T20:02:00Z',
        endUtcOffset: '32400s',
        type: 'AWAKE',
      },
      {
        startTime: '2026-03-14T20:30:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T20:30:30Z',
        endUtcOffset: '32400s',
        type: 'AWAKE',
      },
      {
        startTime: '2026-03-14T21:00:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T21:00:30Z',
        endUtcOffset: '32400s',
        type: 'AWAKE',
      },
      {
        startTime: '2026-03-14T22:00:00Z',
        startUtcOffset: '32400s',
        endTime: '2026-03-14T22:01:00Z',
        endUtcOffset: '32400s',
        type: 'AWAKE',
      },
    ],
  },
};

/** summary もステージも付かない記録。解析前や手動記録で起こりうる */
export const classicSleepDataPoint = {
  name: 'users/1234567890/dataTypes/sleep/dataPoints/43',
  sleep: {
    interval: {
      startTime: '2026-03-10T15:00:00Z',
      startUtcOffset: '32400s',
      endTime: '2026-03-10T22:00:00Z',
      endUtcOffset: '32400s',
    },
    type: 'CLASSIC',
    metadata: { stagesStatus: 'NOT_ENOUGH_DATA', processed: true, mainSleep: true },
  },
};

export const sleepStartingAt = (startTime, id = '1') => ({
  ...sleepDataPoint,
  name: `users/1234567890/dataTypes/sleep/dataPoints/${id}`,
  sleep: { ...sleepDataPoint.sleep, interval: { ...sleepDataPoint.sleep.interval, startTime } },
});

const WATCH = {
  recordingMethod: 'PASSIVELY_MEASURED',
  device: { displayName: 'Watch' },
  platform: 'FITBIT',
};

/** dataSource.device を持たないスマホ側のカウント。足すと二重計上になる */
const PHONE = { recordingMethod: 'PASSIVELY_MEASURED', platform: 'FITBIT' };

const minuteInterval = (startTime, endTime) => ({
  startTime,
  startUtcOffset: '32400s',
  endTime,
  endUtcOffset: '32400s',
});

/** distance の 1 分区間。既定は時計由来の 60 秒ちょうど */
export const distancePoint = (startTime, millimeters, { endTime, source = WATCH } = {}) => ({
  dataSource: source,
  distance: {
    interval: minuteInterval(startTime, endTime ?? addMinute(startTime)),
    millimeters: String(millimeters),
  },
});

/** steps の 1 分区間。既定は時計由来の 60 秒ちょうど */
export const stepsPoint = (startTime, count, { endTime, source = WATCH } = {}) => ({
  dataSource: source,
  steps: {
    interval: minuteInterval(startTime, endTime ?? addMinute(startTime)),
    count: String(count),
  },
});

/** heart-rate は Interval 型ではなく Sample 型で、時刻を 1 点だけ持つ */
export const heartRatePoint = (physicalTime, beatsPerMinute) => ({
  dataSource: WATCH,
  heartRate: {
    sampleTime: { physicalTime, utcOffset: '32400s' },
    beatsPerMinute: String(beatsPerMinute),
  },
});

export const phoneSource = PHONE;

function addMinute(startTime) {
  return new Date(new Date(startTime).getTime() + 60_000).toISOString().replace('.000', '');
}

/** exerciseEvents を持つ運動。手動の開始・停止操作が記録されている */
export const exerciseWithEvents = {
  name: 'users/1234567890/dataTypes/exercise/dataPoints/2222222222',
  exercise: {
    interval: {
      startTime: '2026-03-10T09:45:00Z',
      startUtcOffset: '32400s',
      endTime: '2026-03-10T10:25:00Z',
      endUtcOffset: '32400s',
    },
    exerciseType: 'WALKING',
    activeDuration: '2400s',
    exerciseEvents: [
      { eventTime: '2026-03-10T09:45:00Z', eventUtcOffset: '32400s', exerciseEventType: 'START' },
      { eventTime: '2026-03-10T10:25:00Z', eventUtcOffset: '32400s', exerciseEventType: 'STOP' },
    ],
  },
};

/** 1 分内訳の取得元になる運動。窓は 18:00〜18:03 (ローカル) の 3 分 */
export const shortExerciseDataPoint = {
  name: 'users/1234567890/dataTypes/exercise/dataPoints/3333333333',
  exercise: {
    interval: {
      startTime: '2026-03-10T09:00:30Z',
      startUtcOffset: '32400s',
      endTime: '2026-03-10T09:02:30Z',
      endUtcOffset: '32400s',
    },
    exerciseType: 'RUNNING',
    // オートポーズ分が抜けるので、窓の算出には使わない
    activeDuration: '90s',
  },
};
