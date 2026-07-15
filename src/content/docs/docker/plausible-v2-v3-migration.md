---
title: Plausible CE v2 升 v3 時避免 PostgreSQL 資料目錄不相容
description: Upgrade a self-hosted Plausible Community Edition v2 stack to v3 by logically migrating PostgreSQL, preserving ClickHouse rollback data, and verifying analytics without polluting production traffic.
date: 2026-07-15
tags:
  - plausible
  - docker
  - postgresql
  - clickhouse
  - migration
status: fixed
system: plausible
severity: high
aliases:
  - Plausible v2 to v3 migration
  - PostgreSQL 14 to 16 Plausible
  - ClickHouse 23 to 24 Plausible
  - Plausible community edition upgrade
---

## 快速結論

Plausible CE v3 的官方 compose 使用較新的 PostgreSQL 與 ClickHouse。不要把 PostgreSQL 14 的 data directory 直接掛給 PostgreSQL 16：會因 major version 不相容而無法啟動。保留舊目錄，使用 `pg_dump` custom dump 還原到新的 v16 directory。

ClickHouse 升級前要做 cold backup；先確認資料量與 root disk，保留原 compose、環境檔、舊 image 與資料 archive，直到公開 dashboard、tracker script、資料庫 migration 和既有 analytics counts 都驗證完成。

## 症狀

自架 Plausible 長期使用舊版 compose，常見組合是：

- `plausible/community-edition:latest` 實際停在舊 app image
- PostgreSQL 14 bind mount
- ClickHouse 23.x bind mount

直接把官方 v3 compose 套上去時，PostgreSQL major version 變更是最容易被忽略的破壞點。若把既有 v14 directory 掛給 v16 container，PostgreSQL 會拒絕讀取它。

## 影響範圍

- 服務：Docker Compose 自架 Plausible Community Edition
- 資料：PostgreSQL 的帳號、sites、設定與 migrations；ClickHouse 的 events、sessions 和 location data
- 使用者影響：migration 期間 dashboard 與 tracking 暫時不可用
- 資料風險：沒有 verified backup 時屬高風險；PostgreSQL directory 直接跨 major version 掛載不可接受

## 排查

先確認目前 image、資料掛載方式、資料量和可用空間。不要只看 image tag；`latest` 可能是數月前 pull 的 digest。

```bash
docker compose ps
docker compose config
df -h /
docker exec plausible-plausible_db-1 \
  psql -U postgres -d plausible_db -Atc \
  'SELECT pg_size_pretty(pg_database_size(current_database()));'
docker exec plausible-plausible_events_db-1 \
  clickhouse-client --query \
  'SELECT formatReadableSize(sum(bytes_on_disk)) FROM system.parts WHERE active'
```

比較現有 compose 與目標 v3 branch，特別注意：

- PostgreSQL image / data directory
- ClickHouse image、`CLICKHOUSE_SKIP_USER_SETUP`、low-resource config mounts
- Plausible app image 必須固定 tag，不使用浮動 `latest`
- 新增的 Plausible writable data volume

## 根因

PostgreSQL 的 data directory 不跨 major version 相容。新版 Postgres binary 偵測到舊 cluster format 時會停止，而不是自動升級。

ClickHouse 可以依官方 v3 migration path 升級，但 analytics data 仍是最難重建的資料，因此不能只有 application backup。另一個常見誤判是把 tracker script HTTP 200 當成完整 ingestion 驗證：若 migration 後尚無真實流量，events table 的最新 timestamp 不會自然跨過切換時間。

## 修正

先建立可驗證的回復點。以下範例假設 PostgreSQL 與 ClickHouse 使用 bind mounts；調整 service/container 名稱與路徑即可。

```bash
backup="/srv/backups/plausible/pre-v3-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a compose.yml .env clickhouse "$backup/"

docker exec plausible-plausible_db-1 \
  pg_dump -U postgres -Fc plausible_db > "$backup/plausible_db.pg14.dump"

docker compose down

# Cold copies are the ClickHouse rollback point. Run as a container so root-owned
# database files are readable without changing host permissions.
docker run --rm \
  -v "$PWD/data/event-data:/source:ro" \
  -v "$backup:/backup" \
  --entrypoint tar clickhouse/clickhouse-server:<old-version> \
  -C /source -czf /backup/clickhouse-old-cold.tar.gz .

sha256sum "$backup"/* > "$backup/SHA256SUMS"
```

Keep the original PostgreSQL data directory untouched. Change the v3 compose to use a **new** directory, then start only PostgreSQL and restore the logical dump:

```yaml
plausible_db:
  image: postgres:16-alpine
  volumes:
    - ./data/db-data-v16:/var/lib/postgresql/data
```

```bash
docker compose up -d plausible_db
# Wait until pg_isready / the compose healthcheck is healthy.
docker compose exec -T plausible_db \
  pg_restore -U postgres -C -d postgres < "$backup/plausible_db.pg14.dump"
```

Then use the official v3 ClickHouse configuration files and image, start ClickHouse, verify the old databases and tables are readable, and finally start the Plausible app so its migrations run.

```bash
docker compose up -d plausible_events_db mail
docker compose exec -T plausible_events_db \
  clickhouse-client --query 'SHOW DATABASES'
docker compose up -d plausible
```

## 驗證

- PostgreSQL healthcheck 是 `healthy`，且 users、sites、schema migration counts 存在。
- ClickHouse healthcheck 是 `healthy`，既有 events / sessions table row counts 沒有意外歸零。
- 本機與公開 dashboard root 都回 HTTP 200。
- `/js/script.js` 回 HTTP 200，確認既有網站能取到 tracker。
- app、PostgreSQL、ClickHouse 的 restart count 維持 0，且沒有新的 error-level log。
- 等正常訪客流量產生後，再確認 `max(timestamp)` 已跨過 migration 時點；不要為了驗證而寫入假的正式 pageview。

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/
curl -fsS -o /dev/null -w '%{http_code}\n' https://analytics.example.com/js/script.js
docker exec plausible-plausible_events_db-1 \
  clickhouse-client --query \
  'SELECT max(timestamp) FROM plausible_events_db.events_v2'
```

## 下次先查

1. 先看 free disk、PostgreSQL / ClickHouse 資料量與 bind mount 路徑。
2. 先完成 logical PostgreSQL dump 和 ClickHouse cold archive，再停服務。
3. PostgreSQL major upgrade 永遠使用新 data directory + restore，不直接重掛舊 directory。
4. ClickHouse 起來後先確認舊 events tables 與 byte counts。
5. 最後才啟 app migration，並保留所有 rollback artifacts 到自然 tracking event 也驗證完成。
