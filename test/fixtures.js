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
