# ghealth-mcp

<p align="center">
  <img src="assets/logo.png" alt="ghealth-mcp のロゴ" width="120">
</p>

Google Health API に記録された運動・安静時心拍数・心拍変動・睡眠のデータを参照するための MCP サーバー。

ストリーマブル HTTP のリモート MCP サーバーとして動かすことを前提とし、デプロイ先は Vercel を想定している。そのため常駐プロセスを持たないステートレス構成で、リクエストごとにサーバーインスタンスを作る。stdio でも起動でき、ツールの実装は両方で共通。

単位変換や整形はサーバー側で済ませ、モデルにミリメートルや秒/メートルの計算をさせない方針。距離は km、時間は `M:SS`（1 時間を超えると `H:MM:SS`）、ペースは `M:SS/km` のように、そのまま読める形で返す。

## 必要なもの

- Node.js 24 以上（ESM、トップレベル await を使用）
- Google Cloud プロジェクトで有効化した Google Health API
- デスクトップアプリ型の OAuth クライアント

## セットアップ（手元で stdio として使う）

1. 依存をインストールする。

   ```bash
   npm install
   ```

2. Google Cloud Console でデスクトップアプリ型の OAuth クライアントを作成し、JSON をリポジトリ直下に `client_secret.json` として置く。

3. 認証してトークンを取得する。

   ```bash
   npm run auth
   ```

   認証 URL が標準出力に出るのでブラウザで開き、同意する。環境変数 `BROWSER` にブラウザのパスが設定されていれば自動で開く。完了すると `token.json` が書き出される。

   要求するスコープ（すべて readonly）:

   - `googlehealth.activity_and_fitness.readonly`
   - `googlehealth.location.readonly`
   - `googlehealth.health_metrics_and_measurements.readonly`
   - `googlehealth.sleep.readonly`

4. MCP サーバーとして登録する。

   ```bash
   # Claude Code の場合
   claude mcp add ghealth -- node "$(pwd)/src/server.js"
   ```

認証情報の 2 ファイルは gitignore 済み。場所はリポジトリ直下の決め打ちで、絶対パスで解決するため作業ディレクトリに関係なく動く（環境変数では変えられない）。初回認証（`npm run auth`）と調査用の `scripts/dump-health-api.js` も同じパスを読み書きする。

## リモート MCP として公開する（Vercel）

### 仕組み

`src/index.js` が Hono アプリを export しており、`POST /mcp` でストリーマブル HTTP の MCP エンドポイントになる。ツールの実装は stdio 版と共通（`src/mcp-server.js`）。

Vercel には書き込めるファイルシステムが無いので、認証情報はファイルではなく環境変数で渡す。`GHEALTH_REFRESH_TOKEN` が設定されていれば自動的にこの経路になる。リフレッシュして得た access token はインスタンスのメモリに置くだけで保存しない（Google はリフレッシュ時に refresh_token を差し替えないため、これで足りる）。

### 環境変数を設定する

いずれも JSON ではなく値そのもの（1 行の文字列）を入れる。

| 環境変数 | 必須 | 値 | 取得元 / 既定値 |
| --- | :---: | --- | --- |
| `GHEALTH_CLIENT_ID` | ✅ | OAuth クライアント ID | `client_secret.json` の `installed.client_id` |
| `GHEALTH_CLIENT_SECRET` | ✅ | OAuth クライアントシークレット | `client_secret.json` の `installed.client_secret` |
| `GHEALTH_REFRESH_TOKEN` | ✅ | リフレッシュトークン | `token.json` の `refresh_token` |
| `GHEALTH_MCP_TOKEN` | ✅ | MCP クライアントに持たせる任意の秘密文字列 | 自分で生成する（例: `openssl rand -hex 32`） |
| `GHEALTH_TZ` | | `from` / `to` 省略時の「今日」を決める IANA タイムゾーン名。解決できない値ならその旨を言って失敗する | 既定 `Asia/Tokyo` |

必須の 4 つは設定しないと動かない（`GHEALTH_MCP_TOKEN` が未設定のときはリクエストを全て拒否する）。

取得元のファイルは「セットアップ（手元で stdio として使う）」で作られるので、そちらを先に済ませておく。

取り出しから Vercel への登録までは 1 コマンドでできる。

```bash
vercel link                # 未リンクなら先に
npm run vercel:env         # production に設定する
npm run vercel:env -- --dry-run    # 何をするかだけ見る
npm run vercel:env -- --force      # 既にある値を上書きする
```

値は標準入力で `vercel` に渡すので、コマンドラインにも `ps` にも履歴にも残らない。画面にも出さない。既定では Vercel 上で読み戻せない機微な値（Secret）として登録する。

`GHEALTH_MCP_TOKEN` をまだ決めていない、または作り直したい場合は `--mcp-token` を付ける。新しく生成して設定し、その値を一度だけ表示するので、リクエストヘッダの `x-api-key` にも同じものを設定する。

```bash
npm run vercel:env -- --mcp-token --force
```

その他のオプションは `npm run vercel:env -- --help` を参照。

`token.json` に `refresh_token` が入っていない場合は、`npm run auth` をやり直して同意画面を通す（Google は初回の同意でしか refresh_token を返さないことがある）。

どちらの経路を使うかは `GHEALTH_REFRESH_TOKEN` の有無だけで決まる。`GHEALTH_CLIENT_SECRET` はこの環境変数経路でのみ参照し、常に**シークレットの値そのもの**を表す（ファイル経路は固定パスしか見ないので、パスとの取り違えは起きない）。`GHEALTH_REFRESH_TOKEN` だけあって `GHEALTH_CLIENT_ID` / `GHEALTH_CLIENT_SECRET` が欠けている場合は、欠けている変数名を挙げて起動時に失敗する。

### Claude から繋ぐ

クライアントの認証は `x-api-key` ヘッダーと `GHEALTH_MCP_TOKEN` の定数時間比較。`GHEALTH_MCP_TOKEN` が未設定のときは設定漏れによる無認証公開を避けるため全て拒否する。401 に `WWW-Authenticate` は付けない（付けると claude.ai 側が OAuth の探索を始めてしまう）。

claude.ai のカスタムコネクタに登録するときは、認証方式を「サインインなし」にしたうえでリクエストヘッダーに `x-api-key` を設定する。「今すぐサインイン」を選ぶと、ヘッダーがあっても OAuth が始まって失敗する。

## ツール

返り値は JSON。値が記録されていないフィールドは省略される。

### `list_exercises`

運動を新しい順に一覧する。

| 入力 | 説明 |
| --- | --- |
| `from` | 開始日（`YYYY-MM-DD`、ローカル日付）。省略時は `to` の 30 日前 |
| `to` | 終了日（この日を含む）。省略時は今日 |
| `limit` | 最大件数。既定 20、上限 200 |

`from` / `to` を省略したときの「今日」は `GHEALTH_TZ`（既定 `Asia/Tokyo`）で決まる。実行環境のタイムゾーンが UTC でもずれない。この扱いは `get_resting_heart_rate` / `get_hrv` / `get_sleep` でも同じ。

| 出力 | 説明 |
| --- | --- |
| `id` | 運動の識別子。`get_exercise` / `get_exercise_minutes` に渡す |
| `localDate` | 開始日時（`YYYY-MM-DDTHH:MM:SS+09:00` のようにオフセット付きのローカル時刻） |
| `exerciseType` | 運動種別（API の列挙値。例: `RUNNING`） |
| `displayName` | 記録時に付いた表示名 |
| `distanceKm` | 距離（km、小数 2 桁） |
| `duration` | 実働時間（`M:SS`、1 時間超は `H:MM:SS`）。オートポーズ分は含まない |
| `pacePerKm` | 平均ペース（`M:SS/km`） |
| `avgHeartRate` | 平均心拍数（bpm） |
| `calories` | 消費カロリー（kcal） |
| `hasGps` | GPS の記録があるか |

### `get_exercise`

運動 1 件の詳細を返す。`id` は `list_exercises` が返す値。

`list_exercises` の全項目に加えて、次を返す。

| 出力 | 説明 |
| --- | --- |
| `splits` | 距離ごとのラップ。各要素は `index`（1 始まり）、`distanceKm`、`duration`、`pacePerKm` |
| `steps` | 歩数 |
| `cadence` | 平均ピッチ（歩/分） |
| `strideLengthCm` | 平均ストライド（cm、小数 1 桁） |
| `verticalOscillationCm` | 上下動（cm、小数 1 桁） |
| `verticalRatio` | 上下動比（%、小数 2 桁） |
| `groundContactTimeMs` | 接地時間（ミリ秒） |
| `elevationGainM` | 獲得標高（m、小数 1 桁） |
| `activeZoneMinutes` | アクティブゾーン分数 |
| `heartRateZones` | 心拍ゾーン別の分数（`light` / `moderate` / `vigorous` / `peak`、小数 1 桁） |
| `events` | 記録された操作。各要素は `type` と `time`。入っているときだけ返す |

`events` の `type` で観測できたのは `START` / `STOP` のみで、値は運動の開始・終了時刻と一致する。秒精度の停止検出には使えない。

### `get_exercise_minutes`

運動 1 件を 1 分ごとに分解して返す。`id` は `list_exercises` / `get_exercise` が返す値。

`get_exercise` のサマリーは停止していた時間も均してしまうため、平均ピッチが実際には出していないピッチになる。信号待ちで止まっていた時間と遅く走っていた時間を見分けたいときにこちらを使う。

| 出力 | 説明 |
| --- | --- |
| `time` | ローカル時刻（`HH:MM`） |
| `distanceM` | その 1 分の移動距離（メートル） |
| `steps` | その 1 分の歩数 |
| `cadenceSpm` | ピッチ。60 秒区間なので `steps` と同値 |
| `paceSecPerKm` | その 1 分のペース（秒/km）。`distanceM` が 0 なら `null` |
| `strideCm` | ストライド。`steps` が 0 なら `null` |
| `avgBpm` / `maxBpm` / `minBpm` | その 1 分の心拍。サンプルが 1 件も無ければ `null` |

窓は運動の開始時刻を分単位に切り下げ、終了時刻を切り上げた範囲。距離が 0 の分はレコードごと返ってこないので `distanceM` / `steps` は 0 で埋めるが、心拍は 0 で埋めず `null` にする。

停止判定やフェーズ分割はサーバー側でしない。素のデータと自明な換算だけを返し、解析は呼び出し側に任せる。

### `get_resting_heart_rate`

日ごとの安静時心拍数を日付の昇順で返す。入力は `from` / `to`。予備心拍数（最大心拍数 − 安静時心拍数）を出して心拍ゾーンを評価するときに使う。

| 出力 | 説明 |
| --- | --- |
| `localDate` | 日付（`YYYY-MM-DD`） |
| `bpm` | その日の安静時心拍数（拍/分） |

### `get_hrv`

日ごとの心拍変動（RMSSD）を日付の昇順で返す。入力は `from` / `to`。値は睡眠中に測ったもので、アプリの表示と同じく整数に四捨五入してある。

| 出力 | 説明 |
| --- | --- |
| `localDate` | 日付（`YYYY-MM-DD`） |
| `avgRmssdMs` | 睡眠全体の平均 RMSSD（ミリ秒） |
| `deepSleepRmssdMs` | 深い睡眠中の RMSSD（ミリ秒） |

### `get_sleep`

睡眠セッションを就寝時刻の昇順で返す。入力は `from` / `to`。睡眠は日をまたぐため、期間の指定も `localDate` も**起床日**が基準。

| 出力 | 説明 |
| --- | --- |
| `id` | セッションの識別子 |
| `localDate` | 起床日（`YYYY-MM-DD`） |
| `bedtime` | 就寝時刻（オフセット付きのローカル時刻） |
| `wakeTime` | 起床時刻（同上） |
| `type` | セッション種別（API の列挙値） |
| `isMainSleep` | その晩のメインの睡眠か |
| `timeInBed` | 床上時間（`M:SS`、1 時間超は `H:MM:SS`） |
| `timeAsleep` | 睡眠時間（同じ書式） |
| `awakeMinutes` | 覚醒していた分数 |
| `minutesToFallAsleep` | API が返す入眠潜時（分）。0 以外が入っていたときだけ返す |
| `sleepOnsetMinutes` | 入眠潜時（分）。`stages` 冒頭の `AWAKE` 区間から算出した値 |
| `shortAwakenings` | 数分未満の短い覚醒の回数 |
| `efficiencyPercent` | 睡眠効率（睡眠時間 / 床上時間、%、小数 1 桁） |
| `stageMinutes` | ステージ別の分数（`deep` / `light` / `rem` / `awake` ほか） |

`sleepOnsetMinutes` は入眠潜時。API の `summary.minutesToFallAsleep` は Fitbit 側が埋めておらず常に 0 で来るため、セッション冒頭に連続する `AWAKE` 区間の長さから算出している（`minutesToFallAsleep` は 0 以外が入っていたときだけ返す）。起点は「布団に入った時刻」ではなく「デバイスが睡眠セッションを検出した時刻」なので、体感の寝付きの悪さより短く出る。

## 開発

```bash
npm test          # vitest を 1 回実行
npm run test:watch
```

HTTP 版は Hono アプリを default export しているだけなので、動作確認はテスト（`test/http.test.js`）から `app.request('/mcp', ...)` で直接叩ける。

API のレスポンスを生で確認したいときは調査用スクリプトを使う。

```bash
node scripts/dump-health-api.js dataTypes/exercise/dataPoints
```

`https://health.googleapis.com/v4/users/me/` に続くパスを引数に取る。認証情報を相対パスで読むため、リポジトリ直下から実行すること。

### worktree のブランチを stdio で試す

`src/server.js` に `--worktree` を付けて起動すると、`GHEALTH_WORKTREE` で指定した worktree のツール定義で起動する。値は worktree のパスで、相対パスならこのリポジトリ直下を起点にする。Claude Desktop などに登録した起動コマンドに `--worktree` を足しておけば、試すブランチを変えるたびに登録を書き換えずに済む。

```bash
# .env に書く。実際の環境変数があればそちらを優先する
GHEALTH_WORKTREE=<worktree のパス>
```

- `GHEALTH_WORKTREE` が未設定なら、このリポジトリのツール定義で起動する
- 指定したパスにツール定義（`src/mcp-server.js`）が無いときは、起動せずにエラーで終わる
- 認証情報と依存パッケージは worktree 側のものを使う。worktree に認証情報ファイルが無ければ、このリポジトリ直下からコピーするか、worktree で `npm run auth` を実行する
- `.env` から読むのは `GHEALTH_WORKTREE` だけで、ほかの変数は取り込まない
- worktree に `node_modules` が無ければ、先にそこで `npm install` を実行する
- 切り替えた後は MCP クライアントの再起動が必要

## 構成

| ファイル | 役割 |
| --- | --- |
| `src/mcp-server.js` | MCP のツール定義。入力スキーマと説明文に専念。stdio 版と HTTP 版の共通のファクトリー |
| `src/server.js` | stdio での起動（`serveStdio`）。`--worktree` で worktree のツール定義に切り替える |
| `src/index.js` | HTTP での公開。Hono アプリを export する Vercel のエントリーポイント |
| `src/api-key.js` | `x-api-key` を検証する Hono ミドルウェア |
| `src/health.js` | Google Health API の呼び出しとレスポンスの整形 |
| `src/auth-client.js` | `OAuth2Client` を組み立てる。環境変数経路とファイル経路、リフレッシュ時の書き戻しを担当 |
| `src/auth.js` | 初回認証（ループバックサーバー + PKCE） |
| `scripts/dump-health-api.js` | 生 JSON を出す調査用スクリプト |
| `scripts/set-vercel-env.js` | 認証情報を Vercel の環境変数に設定する（`npm run vercel:env`） |
| `test/` | `src/` のテスト。ソースと 1 対 1 ではなく関心ごとに分ける |
| `test/format.test.js` | `src/health.js` の整形関数（純粋関数）のテスト |
| `test/health.test.js` | `src/health.js` のフィルタ組み立てとページングのテスト |
| `test/http.test.js` | `src/index.js` + `src/api-key.js` のテスト。`app.request('/mcp', ...)` で認証・ツール呼び出し・`serverInfo` を検証する |
| `test/auth-client.test.js` | `src/auth-client.js` のテスト。環境変数経路とファイル経路の切り替え |
| `test/icon.test.js` | `src/icon.js` のテスト |
| `test/worktree.test.js` | `src/server.js` の `--worktree` のテスト。起動先の解決 |
| `test/scripts/` | `scripts/` のテスト。本番コードのテストと混ざらないよう分けている |

`src/mcp-server.js` は `test/http.test.js` が `/mcp` 越しに呼ぶことで、ツール定義と入力スキーマまで一緒に検証される。直接のテストが無いのは `src/auth.js`（ブラウザでの同意が必要）と `scripts/dump-health-api.js`（調査用）の 2 つ。
