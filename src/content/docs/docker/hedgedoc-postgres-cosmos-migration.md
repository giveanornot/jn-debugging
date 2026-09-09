---
title: 搬遷或升級 HedgeDoc 時保留筆記、uploads 與 TLS
description: Move HedgeDoc or perform a PostgreSQL major upgrade with a logical dump, an empty replacement data directory, UID-safe uploads, and verified public routing.
date: 2026-09-09
tags:
  - hedgedoc
  - docker
  - postgresql
  - cosmos
  - cloudflare
  - migration
status: fixed
system: hedgedoc
severity: high
aliases:
  - HedgeDoc Docker migration
  - HedgeDoc PostgreSQL major upgrade
  - PostgreSQL 13 to 17 HedgeDoc
  - HedgeDoc PostgreSQL restore
  - HedgeDoc uploads permission denied
  - Cosmos HedgeDoc route
  - HedgeDoc DNS cutover
---

## 快速結論

搬遷或 PostgreSQL 跨 major 升級 HedgeDoc 時，不要只匯出 Markdown。要保留既有短網址、筆記權限與 metadata，需以 `pg_dump -Fc` 還原 PostgreSQL，再複製 `public/uploads`。

PostgreSQL 不能把舊 major 的 data directory 直接交給新 image。升級時先停止 HedgeDoc 寫入、做並驗證 custom dump，將舊資料目錄保留成可回退副本，建立空的新資料目錄後才啟動新 PostgreSQL 並還原。不要把 compose image tag 直接改掉後重用舊 bind mount。

若目標使用 Cosmos，app container 必須和 Cosmos 位於同一 Docker network，且公開 DNS 必須先指向目標主機，才能完成 Cosmos 的 TLS-ALPN-01 憑證驗證。已有 wildcard DDNS 時，舊的單獨 A record 不會自動搬遷；要建立明確 record，並把 hostname 加入 DDNS 設定。

## 症狀

- 新 host 上只看到空的 HedgeDoc，或 Markdown import 後短網址、權限、建立時間不見。
- `uploads` 已複製，但 app 寫入新圖片時出現 `Permission denied`。
- PostgreSQL image 換成新 major 後無法啟動，或 log 顯示資料庫檔案版本不相容。
- Cosmos route 已建立，公開網域仍回 404、舊主機，或 TLS 顯示憑證錯誤。
- Cloudflare 有 wildcard DDNS record，但特定 HedgeDoc hostname 仍解析到舊主機。

## 影響範圍

- 服務：Docker Compose 的 HedgeDoc 與 PostgreSQL
- 資料：筆記、shortid、alias、權限、metadata、uploads
- 可用性：最後一致性同步與 DNS / Cosmos 切換時會有短暫寫入中斷
- 資料風險：直接複製運行中的 PostgreSQL data directory 可能得到不一致資料；跨 major 重用舊 directory 會無法啟動；只匯入 Markdown 則會遺失應用層 metadata

## 排查

先盤點來源 image、mount、資料量與公開網域；不要把 compose 或環境檔完整輸出，裡面通常有資料庫密碼。

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' \
  | grep -Ei 'hedgedoc|postgres'

docker inspect hedgedoc_app_1 \
  --format '{{.Config.Image}} {{json .Mounts}} {{json .NetworkSettings.Ports}}'

docker exec hedgedoc_database_1 \
  psql -U hedgedoc -d hedgedoc -Atc \
  'SELECT pg_size_pretty(pg_database_size(current_database())), count(*) FROM "Notes";'
```

確認 uploads owner。HedgeDoc image 常以非 root UID 寫入，因此用 SSH 使用者直接解 tar 可能失敗。

```bash
stat -c 'owner=%u:%g mode=%a' ./uploads
find ./uploads -type f -printf '%u:%g %m\n' | sort | uniq -c
```

目標端先查可用空間、HedgeDoc network、Cosmos route 與 DNS。公開 DNS 與權威 DNS 都要查，避免把 resolver cache 當成 record 沒更新。

```bash
df -h /
docker network ls | grep hedgedoc
docker exec cosmos-server cat /config/cosmos.config.json \
  | jq -r '.HTTPConfig.ProxyConfig.Routes[] | [.Host, .Target, .Disabled] | @tsv'

dig +short A notes.example.com
dig @<authoritative-nameserver> +short A notes.example.com
```

## 根因

HedgeDoc 的 PostgreSQL 不只保存 Markdown，也保存 shortid、alias、permission 和 timestamps。Markdown export 適合離機備份或內容轉換，不能取代完整 service migration。

PostgreSQL data directory 的內部格式綁定 major version；Docker image tag 變更不會自動執行 `pg_upgrade`。因此新 major 必須使用空 data directory，再從相容的 logical dump 還原。保留舊 directory 與 dump，才有明確 rollback 路徑。

另外，Docker bind mount 的檔案 UID/GID 直接決定容器內 app 是否能寫入。把 uploads 解到由 SSH 使用者擁有的目錄後，現有檔案可能可讀，新 upload 卻會失敗。

Cosmos 對路由 hostname 申請合併 SAN 憑證。route target 能在 Docker DNS 解析、公開 DNS 又指向新主機，才會完成 TLS-ALPN-01。Cloudflare wildcard record 不會覆蓋同名的舊 explicit A record，因此不能假定 DDNS 已處理該 hostname。

## 修正

固定來源相容版本，在目標建立新 stack，先只起 PostgreSQL。保留來源 compose 的非敏感設定邏輯，但將秘密放在目標專用 environment file 或 secret store。

```bash
cd /srv/docker/hedgedoc
docker compose up -d database

until docker compose exec -T database \
  pg_isready -U hedgedoc -d hedgedoc >/dev/null; do sleep 1; done
```

若是在原主機把 PostgreSQL 升到新 major，先停止 app 和 database，建立可驗證的 dump，並以帶時間戳的名稱保留舊 data directory。確認 compose 的 PostgreSQL image tag 後，建立空目錄；實際 UID/GID 依新 image 為準，以下 `70:0` 是常見範例。

```bash
docker compose stop app
docker compose exec -T database \
  pg_dump -U hedgedoc -d hedgedoc -Fc \
  > /srv/backups/hedgedoc-postgres.dump
pg_restore -l /srv/backups/hedgedoc-postgres.dump >/dev/null
docker compose stop database

mv /srv/docker/hedgedoc/database \
  /srv/docker/hedgedoc/database.pg13-before-pg17
install -d -o 70 -g 0 -m 700 /srv/docker/hedgedoc/database

# Change the compose PostgreSQL image to the intended major, then start only it.
docker compose up -d database
until docker compose exec -T database \
  pg_isready -U hedgedoc -d hedgedoc >/dev/null; do sleep 1; done
docker compose exec -T database \
  pg_restore -U hedgedoc -d hedgedoc \
  --clean --if-exists --no-owner --no-privileges \
  < /srv/backups/hedgedoc-postgres.dump
docker compose up -d app
```

Run the `pg_dump` before stopping the database, not after. The app must be stopped first to prevent writes during the dump and restore window. If any new database start, restore, or app health check fails, stop the new stack and point the compose volume back at the retained old directory and old image tag.

先複製 uploads。若目標目錄由 app UID 擁有，以一次性的 root helper 寫入，不要為了複製把整個 host path 改成 SSH 使用者 owner。以下 UID/GID 只是範例，應以前述 `stat` 的來源值為準。

```bash
tar -C /srv/docker/hedgedoc/uploads -cf - . \
  | docker run --rm -i --user 0 \
      -v /srv/docker/hedgedoc/uploads:/data alpine:3.20 \
      sh -c 'tar -C /data -xf - && chown -R 10000:65533 /data'
```

在最終切換時停止**來源 app**，保留來源 PostgreSQL 當 rollback source；然後把 custom dump 直接串流還原到目標，不要 live-copy PostgreSQL data directory。

```bash
# On the source host: write only pg_dump bytes to stdout.
docker stop hedgedoc_app_1 >&2
docker exec hedgedoc_database_1 \
  pg_dump -U hedgedoc -d hedgedoc -Fc \
  | ssh target-host \
      'docker exec -i hedgedoc-database-1 \
       pg_restore -U hedgedoc -d hedgedoc \
       --clean --if-exists --no-owner --no-privileges'
```

再次同步 uploads 後啟 app，確認 healthcheck 與 notes count。

```bash
docker compose up -d app
docker compose exec -T database \
  psql -U hedgedoc -d hedgedoc -Atc 'SELECT count(*) FROM "Notes";'
docker inspect -f '{{.State.Health.Status}}' hedgedoc-app-1
```

Cosmos proxy 必須可解析 app container。可將 Cosmos 加入 app 的 compose network，然後在 `cosmos.config.json` 以既有 HTTP route 當模板新增目標。修改前備份設定，避免直接手寫不完整 route object。

```bash
docker network connect hedgedoc_default cosmos-server

docker exec cosmos-server cat /config/cosmos.config.json \
  | jq '(.HTTPConfig.ProxyConfig.Routes[] | select(.Name == "existing-app")) as $route
        | .HTTPConfig.ProxyConfig.Routes += [
            ($route
             | .Name = "hedgedoc-app"
             | .Host = "notes.example.com"
             | .Target = "http://hedgedoc-app:3000")
          ]' \
  | docker exec -i cosmos-server sh -c \
      'umask 077; cat > /config/cosmos.config.json.new && mv /config/cosmos.config.json.new /config/cosmos.config.json'

docker restart cosmos-server
```

最後在 DNS provider 建立或更新 explicit A record 指向新主機。若以 DDNS 維護動態 IP，記得把 hostname 加入 DDNS host list；否則這次搬遷成功後，下一次 WAN IP 變動仍會指回舊位址或失效。

## 驗證

- 目標資料庫的 `Notes` count 與來源一致。
- PostgreSQL 的實際 `server_version` 是預期的新 major，且 dump 可以由 `pg_restore -l` 列出。
- source / target uploads 的檔案數、總 bytes 或 checksum manifest 相同。
- app healthcheck 回 `healthy`，`/_health` 回 ready。
- Cosmos container 能解析並連到 app container。
- 用不帶 `-k` 的 HTTPS request 檢查首頁與一個既有 shortid；再抽查 upload URL。

```bash
curl -fsSI https://notes.example.com/
curl -fsS -o /dev/null -w '%{http_code}\n' \
  https://notes.example.com/<existing-shortid>
curl -fsS -o /dev/null -w '%{http_code}\n' \
  https://notes.example.com/uploads/<existing-file>

docker logs --since 10m cosmos-server 2>&1 \
  | grep -E 'notes.example.com|The server validated our request|acme: error'
```

保留來源 PostgreSQL data directory、uploads 與 compose，直到公開 root、筆記 URL、uploads 和 TLS 都驗證完成。

## 下次先查

1. 先查 app / PostgreSQL image、notes count、DB size、uploads UID/GID、可用空間。
2. 跨 major 先做可列出的 custom dump，停止 app 後才切換，並保留舊 data directory。
3. 新 PostgreSQL 只使用空資料目錄；用 `pg_restore` 保留 shortid 和 metadata，不要只搬 Markdown。
4. Cosmos route 先確認 Docker DNS，再確認 authoritative DNS 與 TLS log。
5. 對直接 A record 與 wildcard DDNS 分開檢查，並將搬遷 hostname 加入 DDNS。
