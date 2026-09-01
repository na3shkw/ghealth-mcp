import { createAuthClient } from './auth-client.js';

const BASE = 'https://health.googleapis.com/v4/users/me';

let authClient;
const auth = () => (authClient ??= createAuthClient());

/** `"2400s"` / `"0.3s"` 形式を秒数(number)に変換する */
export function parseSeconds(value) {
  if (value == null) return undefined;
  const digits = String(value).replace(/s$/, '');
  if (digits === '') return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

/** 文字列で来る数値を number にする。未定義は未定義のまま返す */
export function num(value) {
  // Number('') は 0 になるため、空文字を値ありと誤認しないよう先に弾く
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function round(value, digits) {
  if (value == null) return undefined;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 秒数を `MM:SS` または `H:MM:SS` に整形する */
export function formatDuration(seconds) {
  if (seconds == null) return undefined;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** m/秒のペースを `M:SS/km` に整形する */
export function formatPace(secondsPerMeter) {
  if (secondsPerMeter == null) return undefined;
  const perKm = Math.round(secondsPerMeter * 1000);
  return `${Math.floor(perKm / 60)}:${String(perKm % 60).padStart(2, '0')}/km`;
}

/**
 * UTC 時刻に UTC オフセットを足してローカル日時文字列を組み立てる。
 * UTC のまま日付を切ると深夜・早朝のランがずれるため。
 */
export function toLocalDate(startTime, startUtcOffset) {
  if (!startTime) return undefined;
  const offsetSeconds = parseSeconds(startUtcOffset) ?? 0;
  const shifted = new Date(new Date(startTime).getTime() + offsetSeconds * 1000);
  if (Number.isNaN(shifted.getTime())) return undefined;

  const sign = offsetSeconds < 0 ? '-' : '+';
  const abs = Math.abs(offsetSeconds);
  const tz = `${sign}${String(Math.floor(abs / 3600)).padStart(2, '0')}:${String(
    Math.floor((abs % 3600) / 60),
  ).padStart(2, '0')}`;
  return `${shifted.toISOString().slice(0, 19)}${tz}`;
}

/** API の `Date` オブジェクト（年月日、ユーザーのタイムゾーン）を `YYYY-MM-DD` にする */
export function toIsoDay(date) {
  if (!date?.year || !date.month || !date.day) return undefined;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** `users/{uid}/dataTypes/exercise/dataPoints/{id}` の末尾を取り出す */
const dataPointId = (name) => name?.split('/').pop();

export function summarize(dataPoint) {
  const ex = dataPoint.exercise ?? {};
  const m = ex.metricsSummary ?? {};
  const distanceMm = num(m.distanceMillimeters);

  return {
    id: dataPointId(dataPoint.name),
    localDate: toLocalDate(ex.interval?.startTime, ex.interval?.startUtcOffset),
    exerciseType: ex.exerciseType,
    displayName: ex.displayName,
    distanceKm: distanceMm == null ? undefined : round(distanceMm / 1_000_000, 2),
    duration: formatDuration(parseSeconds(ex.activeDuration)),
    pacePerKm: formatPace(num(m.averagePaceSecondsPerMeter)),
    avgHeartRate: num(m.averageHeartRateBeatsPerMinute),
    calories: num(m.caloriesKcal),
    hasGps: ex.exerciseMetadata?.hasGps ?? false,
  };
}

export function detail(dataPoint) {
  const ex = dataPoint.exercise ?? {};
  const m = ex.metricsSummary ?? {};
  const mob = m.mobilityMetrics ?? {};
  const zones = m.heartRateZoneDurations ?? {};

  const zoneMinutes = (value) => {
    const s = parseSeconds(value);
    return s == null ? undefined : round(s / 60, 1);
  };

  const splits = (ex.splits ?? [])
    .filter((s) => s.splitType === 'DISTANCE')
    .map((s, i) => {
      const d = num(s.metricsSummary?.distanceMillimeters);
      return {
        index: i + 1,
        distanceKm: d == null ? undefined : round(d / 1_000_000, 2),
        duration: formatDuration(parseSeconds(s.activeDuration)),
        pacePerKm: formatPace(num(s.metricsSummary?.averagePaceSecondsPerMeter)),
      };
    });

  const elevationMm = num(m.elevationGainMillimeters);
  const strideMm = num(mob.avgStrideLengthMillimeters);
  const oscillationMm = num(mob.avgVerticalOscillationMillimeters);
  const groundContactS = parseSeconds(mob.avgGroundContactTimeDuration);

  return {
    ...summarize(dataPoint),
    splits,
    steps: num(m.steps),
    cadence: num(mob.avgCadenceStepsPerMinute),
    strideLengthCm: strideMm == null ? undefined : round(strideMm / 10, 1),
    verticalOscillationCm: oscillationMm == null ? undefined : round(oscillationMm / 10, 1),
    verticalRatio: round(num(mob.avgVerticalRatio), 2),
    groundContactTimeMs: groundContactS == null ? undefined : round(groundContactS * 1000, 0),
    elevationGainM: elevationMm == null ? undefined : round(elevationMm / 1000, 1),
    activeZoneMinutes: num(m.activeZoneMinutes),
    heartRateZones: {
      light: zoneMinutes(zones.lightTime),
      moderate: zoneMinutes(zones.moderateTime),
      vigorous: zoneMinutes(zones.vigorousTime),
      peak: zoneMinutes(zones.peakTime),
    },
  };
}

/** 安静時心拍数の dataPoint を `{ localDate, bpm }` に整形する */
export function restingHeartRate(dataPoint) {
  const rhr = dataPoint.dailyRestingHeartRate ?? {};
  return {
    localDate: toIsoDay(rhr.date),
    bpm: num(rhr.beatsPerMinute),
  };
}

/** 睡眠ステージの enum を出力キーに対応づける */
const SLEEP_STAGE_KEYS = {
  DEEP: 'deep',
  LIGHT: 'light',
  REM: 'rem',
  AWAKE: 'awake',
  ASLEEP: 'asleep',
  RESTLESS: 'restless',
};

/** 開始・終了を直に持つ区間（stages など）の経過秒数。片方でも欠けていれば undefined */
export function intervalSeconds(interval) {
  const start = new Date(interval?.startTime ?? '').getTime();
  const end = new Date(interval?.endTime ?? '').getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return (end - start) / 1000;
}

/** 分（int64 なので文字列で来る）を `H:MM:SS` に整形する */
const minutesToDuration = (minutes) => {
  const n = num(minutes);
  return n == null ? undefined : formatDuration(n * 60);
};

/**
 * 入眠までにかかった分数を stages の先頭から求める。
 * summary.minutesToFallAsleep は Fitbit 側が埋めておらず常に 0 で来るため、
 * セッション冒頭に連続する AWAKE 区間の長さを代わりに使う。
 * 「布団に入ってから」ではなく「デバイスが睡眠セッションを検出してから」が起点。
 */
export function sleepOnsetMinutes(stages) {
  if (!Array.isArray(stages) || stages.length === 0) return undefined;

  // 並び順は保証されていないので開始時刻で整列してから先頭を見る
  const sorted = [...stages].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  let seconds = 0;
  for (const stage of sorted) {
    if (stage.type !== 'AWAKE') break;
    const s = intervalSeconds(stage);
    // 区間の長さが取れないものが混じったら潜時は確定できない
    if (s == null) return undefined;
    seconds += s;
  }
  return round(seconds / 60, 1);
}

/**
 * 睡眠の dataPoint を整形する。
 * ステージ別の分数は API の summary.stagesSummary をそのまま使う。
 * stages の区間を積み上げても近い値にはなるが、summary 側が Fitbit の確定値。
 */
export function sleepSession(dataPoint) {
  const s = dataPoint.sleep ?? {};
  const interval = s.interval ?? {};
  const summary = s.summary ?? {};

  const stageMinutes = {};
  for (const stage of summary.stagesSummary ?? []) {
    const key = SLEEP_STAGE_KEYS[stage.type];
    const minutes = num(stage.minutes);
    if (key && minutes != null) stageMinutes[key] = minutes;
  }

  const asleep = num(summary.minutesAsleep);
  const inBedSeconds = intervalSeconds(interval);
  const inBed =
    num(summary.minutesInSleepPeriod) ?? (inBedSeconds == null ? undefined : inBedSeconds / 60);
  // 終了側のオフセットで起床時刻を組む
  const wakeTime = toLocalDate(interval.endTime, interval.endUtcOffset ?? interval.startUtcOffset);

  return {
    id: dataPointId(dataPoint.name),
    // 就寝は日をまたぐため、起床日を「その晩」の代表日として扱う
    localDate: wakeTime?.slice(0, 10),
    bedtime: toLocalDate(interval.startTime, interval.startUtcOffset),
    wakeTime,
    type: s.type,
    isMainSleep: s.metadata?.mainSleep,
    timeInBed: minutesToDuration(summary.minutesInSleepPeriod) ?? formatDuration(inBedSeconds),
    timeAsleep: minutesToDuration(summary.minutesAsleep),
    awakeMinutes: num(summary.minutesAwake),
    // 常に 0 で来る値を「即座に入眠」と読み違えないよう、埋まっているときだけ返す
    minutesToFallAsleep: num(summary.minutesToFallAsleep) || undefined,
    sleepOnsetMinutes: sleepOnsetMinutes(s.stages),
    // 眠りの分断の指標。数分未満の覚醒は stages ではなくこちらに入る
    shortAwakenings: s.shortAwakenings?.length,
    efficiencyPercent: asleep != null && inBed ? round((asleep / inBed) * 100, 1) : undefined,
    stageMinutes: Object.keys(stageMinutes).length > 0 ? stageMinutes : undefined,
  };
}

const isoDate = (date) => date.toISOString().slice(0, 10);

function shiftDays(isoDay, days) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export async function listExercises({ from, to, limit = 20 } = {}) {
  const today = isoDate(new Date());
  const toDay = to ?? today;
  const fromDay = from ?? shiftDays(toDay, -30);

  // civil_start_time はローカル時刻。to を含めるため翌日 0 時未満で切る
  const filter =
    `exercise.interval.civil_start_time>="${fromDay}T00:00:00" AND ` +
    `exercise.interval.civil_start_time<"${shiftDays(toDay, 1)}T00:00:00"`;

  const results = [];
  let pageToken;

  do {
    const params = new URLSearchParams({ filter, pageSize: '50' });
    if (pageToken) params.set('pageToken', pageToken);

    const { data } = await auth().request({
      url: `${BASE}/dataTypes/exercise/dataPoints?${params}`,
    });

    for (const dp of data.dataPoints ?? []) {
      results.push(summarize(dp));
      if (results.length >= limit) return results;
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

export async function getExercise(id) {
  const { data } = await auth().request({
    url: `${BASE}/dataTypes/exercise/dataPoints/${encodeURIComponent(id)}`,
  });
  return detail(data);
}

export async function listRestingHeartRate({ from, to } = {}) {
  const today = isoDate(new Date());
  const toDay = to ?? today;
  const fromDay = from ?? shiftDays(toDay, -30);

  // date は日単位の値。to を含めるため翌日未満で切る
  const filter =
    `daily_resting_heart_rate.date>="${fromDay}" AND ` +
    `daily_resting_heart_rate.date<"${shiftDays(toDay, 1)}"`;

  const results = [];
  let pageToken;

  do {
    const params = new URLSearchParams({ filter, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);

    const { data } = await auth().request({
      url: `${BASE}/dataTypes/daily-resting-heart-rate/dataPoints?${params}`,
    });

    for (const dp of data.dataPoints ?? []) results.push(restingHeartRate(dp));
    pageToken = data.nextPageToken;
  } while (pageToken);

  // 推移を追いやすいよう日付の昇順で返す
  return results.sort((a, b) => (a.localDate ?? '').localeCompare(b.localDate ?? ''));
}

export async function listSleep({ from, to } = {}) {
  const today = isoDate(new Date());
  const toDay = to ?? today;
  const fromDay = from ?? shiftDays(toDay, -30);

  // sleep は civil_end_time（起床時刻のローカル時刻）でしか絞り込めない。
  // localDate を起床日にしてあるのと同じ基準になる。to を含めるため翌日 0 時未満で切る
  const filter =
    `sleep.interval.civil_end_time>="${fromDay}T00:00:00" AND ` +
    `sleep.interval.civil_end_time<"${shiftDays(toDay, 1)}T00:00:00"`;

  const results = [];
  let pageToken;

  do {
    // sleep はページサイズの上限が 25
    const params = new URLSearchParams({ filter, pageSize: '25' });
    if (pageToken) params.set('pageToken', pageToken);

    const { data } = await auth().request({
      url: `${BASE}/dataTypes/sleep/dataPoints?${params}`,
    });

    for (const dp of data.dataPoints ?? []) results.push(sleepSession(dp));
    pageToken = data.nextPageToken;
  } while (pageToken);

  // 推移を追いやすいよう就寝時刻の昇順で返す
  return results.sort((a, b) => (a.bedtime ?? '').localeCompare(b.bedtime ?? ''));
}
