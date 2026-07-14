---
title: RSSHub Docker 缺 Chromium 導致 puppeteer-real-browser route 503
description: RSSHub routes using puppeteer-real-browser need PUPPETEER_REAL_BROWSER_SERVICE or CHROMIUM_EXECUTABLE_PATH; browserless websocket alone is not enough.
date: 2026-07-14
tags:
  - rsshub
  - docker
  - chromium
  - puppeteer
  - browserless
status: fixed
system: rsshub
severity: medium
aliases:
  - PUPPETEER_REAL_BROWSER_SERVICE
  - CHROMIUM_EXECUTABLE_PATH
  - RSSHub Chromium Docker
---

## 快速結論

RSSHub route 若改用 `puppeteer-real-browser`，Docker container 內必須有 `PUPPETEER_REAL_BROWSER_SERVICE` 或 `CHROMIUM_EXECUTABLE_PATH`。既有的 `PUPPETEER_WS_ENDPOINT=ws://browserless:3000` 不等於 real-browser HTTP render service。

官方 Dockerfile 可用 `--build-arg PUPPETEER_SKIP_DOWNLOAD=0` 把 Chromium 與必要 library 打進 image。container 以 root 跑 Chromium 時，route launch args 也要包含 `--no-sandbox`。

## 症狀

RSSHub container health 是 healthy，但特定 route 回 503。

HTML error page 或 logs 會看到：

```text
Error: PUPPETEER_REAL_BROWSER_SERVICE or CHROMIUM_EXECUTABLE_PATH is required to use this route.
```

服務狀態可能看起來都正常：

```text
rsshub-rsshub-1   Up (healthy)
rsshub-redis-1    Up (healthy)
browserless       Up (healthy)
```

但 route 仍失敗。

## 影響範圍

- Service：RSSHub on Docker Compose
- Route：需要 `puppeteer-real-browser` 的 route
- 影響：健康檢查通過，但該 route 對使用者不可用
- Data risk：無資料毀損

## 排查

先確認 container image 與 health：

```bash
docker compose ps
docker inspect rsshub-rsshub-1 \
  --format 'image={{.Config.Image}} health={{.State.Health.Status}}'
```

從 container 裡打 route，不要先繞 reverse proxy：

```bash
docker exec rsshub-rsshub-1 sh -lc '
  curl -sS -D /tmp/route.headers \
    "http://localhost:1200/dcard/<board>" \
    -o /tmp/route.body
  awk "NR==1 {print}" /tmp/route.headers
  sed -n "1,80p" /tmp/route.body
'
```

看 logs：

```bash
docker logs --tail=200 rsshub-rsshub-1
```

檢查 browser config：

```bash
docker exec rsshub-rsshub-1 env | grep -E 'PUPPETEER|CHROMIUM'
docker exec rsshub-rsshub-1 test -f /app/.env && cat /app/.env
```

如果只看到 `PUPPETEER_WS_ENDPOINT`，但 route code 檢查的是 `PUPPETEER_REAL_BROWSER_SERVICE` 或 `CHROMIUM_EXECUTABLE_PATH`，就是錯層設定。

## 根因

RSSHub 同時支援多種 browser integration。一般 Puppeteer/browserless websocket 由 `PUPPETEER_WS_ENDPOINT` 控制；但 `puppeteer-real-browser` route 需要另一組設定：

```text
PUPPETEER_REAL_BROWSER_SERVICE
CHROMIUM_EXECUTABLE_PATH
```

所以「compose 裡已經有 browserless」不能保證 real-browser route 能跑。若沒有 real-browser service，就要讓 RSSHub container 自己有 Chromium executable。

另一個 Docker 陷阱是 sandbox。container 常以 root 執行，Chromium 沒加 sandbox 參數時可能啟動失敗。

## 修正

用 RSSHub Dockerfile build 包含 Chromium 的 image：

```bash
docker build \
  --build-arg PUPPETEER_SKIP_DOWNLOAD=0 \
  -t localhost/rsshub:dcard-chromium .
```

Dockerfile 在成功下載 Chromium 後會寫入：

```text
CHROMIUM_EXECUTABLE_PATH=/app/node_modules/.cache/puppeteer/chrome/.../chrome
```

route launch options 補 root container 需要的 args：

```ts
const realBrowserOption = {
  args: [
    '--start-maximized',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ],
};
```

compose 指向新 image，重建單一 service：

```yaml
services:
  rsshub:
    image: localhost/rsshub:dcard-chromium
```

```bash
docker compose up -d --no-deps --force-recreate rsshub
```

## 驗證

等 healthcheck 變 healthy：

```bash
for i in $(seq 1 12); do
  docker inspect rsshub-rsshub-1 \
    --format '{{.State.Health.Status}}'
  sleep 5
done
```

確認 image 與 Chromium executable：

```bash
docker inspect rsshub-rsshub-1 \
  --format 'image={{.Config.Image}} health={{.State.Health.Status}}'

docker exec rsshub-rsshub-1 sh -lc '
  grep CHROMIUM_EXECUTABLE_PATH /app/.env
  test -x "$(grep CHROMIUM_EXECUTABLE_PATH /app/.env | cut -d= -f2-)"
'
```

測 route：

```bash
docker exec rsshub-rsshub-1 sh -lc '
  curl -sS -m 180 -D /tmp/dcard.headers \
    "http://localhost:1200/dcard/<board>" \
    -o /tmp/dcard.xml
  awk "NR==1 {print}" /tmp/dcard.headers
  grep -o "<item>" /tmp/dcard.xml | wc -l
'
```

預期：

```text
HTTP/1.1 200 OK
items > 0
```

## 下次先查

RSSHub container healthy 但 browser route 503 時，先看 route 需要哪種 browser integration。

最短路徑：

1. `docker logs --tail=200 rsshub-rsshub-1`
2. 搜 `PUPPETEER_REAL_BROWSER_SERVICE` / `CHROMIUM_EXECUTABLE_PATH`
3. `docker exec ... cat /app/.env`
4. 確認 image 是否用 `PUPPETEER_SKIP_DOWNLOAD=0` build
5. root container 啟動 Chromium 時檢查 `--no-sandbox`
