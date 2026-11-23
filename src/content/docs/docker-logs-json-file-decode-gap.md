---
title: Docker logs 只顯示舊紀錄，dockerd 出現 json-file 解碼錯誤
description: 比對 Docker CLI、dockerd 與應用程式輪替日誌的時間範圍，在 json-file 讀取中斷時補查缺漏的事件。
date: 2026-11-24
category: containers
tags:
  - docker
  - json-file
  - logging
  - cosmos
status: investigating
system: Docker Engine
severity: medium
aliases:
  - docker logs missing recent entries
  - Error decoding log file
  - docker json-file NUL
---

## 快速結論

容器正常服務，`docker logs` 卻只出現舊紀錄時，先核對最後一筆時間，再看 dockerd 同時段有無解碼錯誤。若服務有自己的日誌，用現行檔和輪替檔補查，並記下實際涵蓋的起訖時間。

## 症狀

一個運作中的反向代理仍在接收請求，Docker CLI 讀取長區間時卻只回傳兩天多以前的紀錄。縮小到最近二十分鐘也得不到資料。同次查詢在 dockerd 留下以下錯誤。

~~~text
Error decoding log file
invalid character '\x00' looking for beginning of value
~~~

## 排查

1. 核對容器的啟動時間、目前狀態、日誌驅動和 `LogPath`。例中驅動是 `json-file`，日誌檔仍在更新。
2. 分別查七天和二十分鐘的紀錄，核對實際首末時間。查詢時同步核對 dockerd journal。兩個時間窗都要比對，因為較長查詢仍可能吐出一段可讀的舊資料。
3. 找到服務自己寫入的現行檔和壓縮輪替檔。Cosmos 的 `cosmos.log` 與 `cosmos.plain.log` 兩系列在本案例有重疊，選一系列統計可避免重複計數。確認服務日誌使用的時區，再跟 Docker 的時間戳對齊。

~~~bash
container='YOUR_CONTAINER'
docker inspect --format \
  '{{.State.Status}} {{.State.StartedAt}} {{.HostConfig.LogConfig.Type}} {{.LogPath}}' \
  "$container"

set -o pipefail
for window in 168h 20m; do
  printf '%s ' "$window"
  docker logs --since "$window" --timestamps "$container" 2>&1 |
    awk '/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ {
      if (++count == 1) first = $1
      last = $1
    }
    END { print "records=" (count+0), "first=" first, "last=" last }' ||
    printf 'docker logs 管線失敗，結束碼 %s\n' "$?" >&2
done

sudo journalctl -u docker --since '10 minutes ago' \
  --grep='Error decoding log file' --no-pager
~~~

## 根因與補查方式

dockerd 讀取 JSON 日誌時遇到無法解碼的 NUL 位元組。NUL 從哪裡寫入、同一檔案內實際受影響的範圍仍待釐清。這次從應用程式輪替日誌補查所需的請求時間窗，Docker 日誌讀取仍待修復。保留事件證據，避免直接編輯或截短 Docker 管理中的日誌檔。 [Docker json-file 日誌驅動文件](https://docs.docker.com/engine/logging/drivers/json-file/)

## 驗證

應用程式日誌可以解析到查核當下，補足 Docker CLI 漏掉的最近兩天多。以應用程式日誌補查後，要各自記錄可取得的來源與時間範圍。修復 Docker 這一層後，再確認一筆新產生的正常請求同時出現在應用程式日誌與 `docker logs --since 20m --timestamps`，並檢查 dockerd 是否還出現同樣錯誤。
