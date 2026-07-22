---
title: Cloudflare Pages Direct Upload 的 upload-token 回 405
description: A Pages Direct Upload client gets HTTP 405 when it POSTs to upload-token; the current Wrangler flow obtains that JWT with GET, then POSTs assets and deployments separately.
date: 2026-07-16
tags:
  - cloudflare
  - pages
  - direct-upload
  - oauth
  - cors
status: fixed
system: cloudflare-pages
severity: medium
aliases:
  - Pages upload-token 405
  - Cloudflare Pages Direct Upload JWT
  - GET upload-token
  - Pages assets check-missing
  - localhost CORS relay
---

## 快速結論

Cloudflare Pages Direct Upload 的 upload JWT 不是用 `POST` 取得。現行 Wrangler 流程使用：

```text
GET  /accounts/:account_id/pages/projects/:project_name/upload-token
POST /pages/assets/check-missing
POST /pages/assets/upload
POST /pages/assets/upsert-hashes
POST /accounts/:account_id/pages/projects/:project_name/deployments
```

若把第一個 endpoint 寫成 `POST`，會在上傳開始前收到 `HTTP 405`。取得 JWT 後的 asset endpoints 才是 `POST`。

## 症狀

以 OAuth access token 建立或選定 Pages project 後，發布流程停在「取得 upload token」：

```text
發布失敗（取得 Pages upload token）：HTTP 405
```

後續的 `check-missing`、asset upload、manifest deployment 都還沒有執行。

## 影響範圍

- Service：Cloudflare Pages Direct Upload
- 影響：任何自行實作 Pages upload flow 的 CLI、PWA 或 serverless relay
- 資料風險：沒有內容毀損；請求在拿到 upload JWT 前就失敗

## 排查

先把發布流程的錯誤標上階段，避免把 405 誤判為 asset upload 或 deployment API 失敗。

接著比對正在使用的 Wrangler 版本的實作，而不是只依過時的範例猜 method：

```bash
rg -n -C 3 'pages/projects/.*/upload-token' node_modules/wrangler
```

現行流程的關鍵形狀是：

```ts
const { jwt } = await fetchResult(
  `/accounts/${accountId}/pages/projects/${projectName}/upload-token`
); // no method option: fetch defaults to GET

await fetchResult('/pages/assets/check-missing', {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ hashes })
});
```

如果程式經過 allowlist relay，也要同時檢查 relay 是否只允許了錯的 `POST` method。

## 根因

把 Pages 的 upload-session 思路套到 `upload-token` endpoint，讓 client 和 relay 都把它實作成 `POST`。

Pages Direct Upload 是兩段授權：帳號 OAuth token 先以 `GET` 換短期 upload JWT；該 JWT 再用於 asset API 的 `POST`。兩段 token 與 methods 不相同。

## 修正

把 upload token request 改為明確 `GET`，並保留 asset 與 deployment request 的 `POST`：

```diff
- await apiRequest(uploadTokenPath, { method: 'POST' })
+ await apiRequest(uploadTokenPath, { method: 'GET' })
```

若使用 PWA，OAuth authorization/token/revoke endpoint 的 CORS 設定不會自動改變通用 `api.cloudflare.com` REST API 的 CORS policy。需要 browser client 時，relay 應維持最小權限：固定 origin、精確 path + method allowlist、只轉送當次 `Authorization` header，且不保存 token 或內容。

本機測試時，`localhost` 與 `127.0.0.1` 是不同 Origin。若 Vite 開在 `http://localhost:5173`，relay 即使已允許 `http://127.0.0.1:5173`，瀏覽器仍會在帳號 discovery 前以 `Failed to fetch` 失敗。兩者都需要明確列入 allowlist：

```js
const PWA_ORIGINS = new Set([
  "https://publisher.example",
  "http://127.0.0.1:5173",
  "http://localhost:5173"
]);
```

不要把它放寬成反射任意 `Origin`。預檢應只對 allowlist 中的來源回傳相同的 `Access-Control-Allow-Origin`：

```bash
curl -i -X OPTIONS \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization' \
  https://publisher.example/api/cloudflare/accounts
```

預期是 `204` 和 `Access-Control-Allow-Origin: http://localhost:5173`；若回 `403 Origin is not allowed`，先部署更新過的 relay，再重新測試。

## 驗證

- 對 upload token endpoint 使用 `GET` 後，收到 JWT 而非 405。
- 用 JWT 成功完成 `check-missing`、asset upload 與 manifest deployment。
- 輪詢 deployment 回報 success，並能讀取公開 Pages URL。
- refresh OAuth token 後，重跑帳號 discovery 確認 relay 沒有依賴 token storage。

## 下次先查

Pages Direct Upload 出現 405 時，先確認失敗階段。

1. `upload-token` → 應為 `GET`，使用帳號 OAuth token。
2. `pages/assets/*` → 應為 `POST`，使用 upload JWT。
3. `deployments` → 應為 `POST`，提交 manifest。
4. 有 relay 時，核對每一條 path 的 method allowlist，而不是擴成泛用 proxy。
