---
title: Mastodon 關閉公開預覽時 public timeline 回 422
description: Mastodon instance 關閉 public preview 後，公開時間軸 API 會要求 app token 與 read:statuses；以最小 OAuth client credentials 修復。
date: 2026-08-14
tags:
  - mastodon
  - fediverse
  - oauth
  - api
  - public-timeline
status: fixed
system: mastodon
severity: medium
aliases:
  - Mastodon public timeline 422
  - This method requires an authenticated user
  - Mastodon read:statuses app token
---

## 快速結論

Mastodon instance 若關閉 public preview，`/api/v1/timelines/public` 不再接受未登入請求。建立只含 `read:statuses` scope 的 app，透過 `client_credentials` 換取 app token，再以 `Authorization: Bearer` 呼叫時間軸。

不要把 `422` 直接當成 URL、參數或 rate limit 問題；先讀 response body。不同版本或站方設定可能回 `401` 或 `422`，但關鍵訊息都是要求已授權的請求。

## 症狀

本地公開時間軸在其他 Mastodon instance 可讀，特定 instance 卻回：

```text
GET /api/v1/timelines/public?local=true&limit=40
HTTP 422
{"error":"This method requires an authenticated user"}
```

加減 `local`、`remote` 或 `limit` 參數後結果不變。

## 影響範圍

- Service：Mastodon REST API
- Endpoint：`GET /api/v1/timelines/public`
- 影響：無法擷取該站可見的公開貼文，其他 instance 不受影響
- Data risk：無；只影響讀取流程

## 排查

先保留 response body，而非只使用 `--fail`：

```bash
curl -sS -D /tmp/timeline.headers -o /tmp/timeline.json \
  'https://<instance>/api/v1/timelines/public?local=true&limit=40'

head -n 1 /tmp/timeline.headers
cat /tmp/timeline.json
```

確認 instance 本身可用，並取得 OAuth server metadata：

```bash
curl -fsS 'https://<instance>/api/v2/instance' | jq '{domain, version}'
curl -fsS 'https://<instance>/.well-known/oauth-authorization-server' \
  | jq '{authorization_endpoint, token_endpoint, app_registration_endpoint, scopes_supported}'
```

如果 instance metadata 正常、未授權的時間軸固定回「requires an authenticated user」，表示不是 API 停機。Mastodon 官方文件指出，關閉 public preview 時，公開時間軸需要 app token 與 `read:statuses` scope。

## 根因

站方的 access-control 設定關閉了 public preview。時間軸內的貼文仍可能是 public visibility，但 API 不再允許匿名列舉；這是可見性與 API 存取政策，不是帳號權限故障。

## 修正

在目標 instance 註冊一個唯讀 app，scope 只選 `read:statuses`。使用 instance 顯示的 app registration endpoint，或其設定頁建立 application；不要加入 `write`、`follow` 或帳號資料的 scope。

以 app 的 client credentials 取得 token：

```bash
curl -fsS -X POST 'https://<instance>/oauth/token' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'client_id=<client_id>' \
  --data-urlencode 'client_secret=<client_secret>' \
  --data-urlencode 'scope=read:statuses'
```

將回傳的 `access_token` 存入權限為 `600` 的私密檔或 secret manager，絕不放進 repository、shell history、日誌或 issue。讀取時間軸時才載入：

```bash
curl -fsS --max-time 20 \
  -H "Authorization: Bearer $MASTODON_ACCESS_TOKEN" \
  -H 'Accept: application/json' \
  'https://<instance>/api/v1/timelines/public?local=true&limit=40' \
  | jq 'length'
```

## 驗證

- token 私密檔為 owner-only，例如 mode `600`
- API 回 `200`，且 response 是 status array
- `local=true&limit=40` 最多回傳 40 筆，欄位含 `url`、`account` 與 `content`
- 未授權請求仍被拒絕，確認沒有意外放寬 instance 的 public-preview 政策

## 下次先查

1. 先保留 HTTP status 與 JSON error body。
2. 讀 `/.well-known/oauth-authorization-server` 確認 token 與 app registration endpoint。
3. 對 public timeline 使用最小的 app token：`read:statuses`。
4. token 只在呼叫時從 secret storage 載入，檢查時只輸出 HTTP status 與筆數。
