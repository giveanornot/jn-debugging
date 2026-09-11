---
title: NewsBlur 自訂網域被誤判為使用者子網域，首頁無限重導
description: NewsBlur 自訂子網域未列入 ALLOWED_SUBDOMAINS 時，匿名首頁會重導回相同 URL，導致瀏覽器 ERR_TOO_MANY_REDIRECTS。
date: 2026-09-11
tags:
  - newsblur
  - docker
  - custom-domain
  - redirect-loop
  - django
status: fixed
system: newsblur
severity: high
aliases:
  - ERR_TOO_MANY_REDIRECTS NewsBlur
  - NewsBlur custom domain redirect loop
  - ALLOWED_SUBDOMAINS
---

## 快速結論

NewsBlur 會把 hostname 的第一段視為可能的使用者子網域。若自訂網址的第一段不在 `ALLOWED_SUBDOMAINS`，而資料庫中又沒有同名使用者，首頁會重導到 canonical homepage；當 canonical hostname 就是原網址時，便成為無限重導。

將自訂 hostname 的第一段加入 `apps/reader/views.py` 的 `ALLOWED_SUBDOMAINS`，重啟 Web 容器後即可恢復。上游 rebase 後要重新檢查這類非上游 patch 是否還在。

## 症狀

- 瀏覽器顯示 `ERR_TOO_MANY_REDIRECTS`。
- 不帶 cookie 的 request 仍持續收到相同的 `302 Location`。
- `/status` 正常，但 `/` 與 `/reader/` 無法開啟。

```text
HTTP/2 302
location: https://reader.example.net/
server: gunicorn
```

## 影響範圍

- Service: Docker Compose 自架 NewsBlur。
- Host or environment: 使用自訂子網域作為 NewsBlur 公開入口。
- User-visible impact: 首頁與 reader 無法使用；健康檢查不一定失敗。
- Data risk: 無資料損毀。

## 排查

先用不帶瀏覽器狀態的 request 排除 cookie，並比較首頁與 health endpoint：

```bash
curl -k -I --max-redirs 5 https://reader.example.net/
curl -k -I https://reader.example.net/status
docker compose ps newsblur_web haproxy
```

若 `newsblur_web` 健康、`/status` 為 `200`，但首頁由 Gunicorn 重導回相同 URL，檢查首頁處理邏輯與 allowlist：

```bash
grep -n -A18 'ALLOWED_SUBDOMAINS' apps/reader/views.py
sed -n '300,325p' apps/reader/views.py
```

首頁的 `index()` 會在 hostname 被解析成未允許子網域時，查詢同名使用者。查無使用者就回到目前 `Site` 的首頁；自訂網域第一段恰好成為該查詢字串時，會留下同 URL 的重導。

## 根因

自訂網域所需的本機 patch 在上游 rebase 後消失。`get_subdomain()` 仍從 hostname 取出第一段，但 `ALLOWED_SUBDOMAINS` 未包含該字串，因此把部署網域誤判成 profile URL。

這與 cookie 清除或 proxy 是否存活無關；無 cookie request 與公開 health endpoint 可以快速區分。

## 修正

在 allowlist 中保留自訂 hostname 的第一段。以下範例以 `reader` 為入口：

```diff
 ALLOWED_SUBDOMAINS = [
     "www",
     "nb",
+    # Custom deployment hostname, not a user profile subdomain.
+    "reader",
 ]
```

只重啟載入 Django code 的服務：

```bash
docker compose restart newsblur_web
```

不要把自訂 hostname 加成假使用者，也不要只關閉瀏覽器 cookie；兩者沒有處理 hostname 判斷。

## 驗證

```bash
docker compose ps newsblur_web haproxy
for path in / /reader/ /status; do
  curl -k -sS -o /dev/null -w "$path %{http_code} %{redirect_url}\n" \
    "https://reader.example.net$path"
done
```

- `newsblur_web` 與 `haproxy` 都是 running。
- `/`、`/reader/` 與 `/status` 均回 `200`，且首頁沒有 redirect URL。
- 瀏覽器重新載入後不再出現 `ERR_TOO_MANY_REDIRECTS`。

## 下次先查

NewsBlur 在自訂網域下出現同 URL 的 302 loop 時，先用無 cookie `curl` 驗證，再檢查 `ALLOWED_SUBDOMAINS` 是否包含 hostname 第一段。每次 rebase 後一併 review 本機 custom-domain patch。
