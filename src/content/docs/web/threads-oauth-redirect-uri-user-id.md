---
title: Threads OAuth 被 redirect URI 阻擋，或交換後缺少 user ID
description: A Threads integration can fail before consent because the callback is not allowlisted, then fail after consent if it assumes user_id is present in the token exchange response.
date: 2026-08-16
tags:
  - threads
  - meta
  - oauth
  - pwa
  - cloudflare-worker
status: fixed
system: threads-api
severity: medium
aliases:
  - Threads error 1349168
  - URL blocked valid OAuth redirect URI
  - Threads did not return a valid Threads user ID
  - Threads OAuth access token no user_id
---

## 快速結論

Threads OAuth 有兩個容易連續出現、但發生在不同階段的問題：

1. 授權前，Meta 要求 `redirect_uri` 精確出現在 Valid OAuth Redirect URIs，且 web/client OAuth login 已啟用。
2. 授權後，token exchange 可只回傳 `access_token`。不要要求短期 token response 一定有 `user_id`；先交換長期 token，再以 `GET /me?fields=id` 取得可發布的帳號 ID。

OAuth code 只能用一次。修正 redirect 或 relay 後都要從應用程式重新開始連接。

## 症狀

授權視窗在同意前顯示：

```json
{
  "error_code": 1349168,
  "error_message": "URL Blocked: This redirect failed because the redirect URI is not whitelisted"
}
```

allowlist 修好並完成登入後，PWA 又可能在 callback 顯示：

```text
Threads did not return a valid Threads user ID.
```

## 影響範圍

- Service：使用 Threads API 的 browser PWA 與最小權限 OAuth relay。
- 使用者影響：無法建立本機 Threads connection；不會發出貼文。
- 資料風險：低；失敗發生在 token／profile 初始化前，access token 不應寫入可攜資料或伺服端。

## 排查

先從授權 URL 取出 `redirect_uri`，不要把 callback 後的 `code`、`state` 一起複製到 Meta 設定：

```text
https://publisher.example/
```

若 callback 是由 PWA 動態產生，驗證它使用的完整 origin 與 pathname：

```ts
function callbackUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}
```

從另一台機器操作時，不要填開發機的 `localhost` callback；使用者瀏覽器必須可透過 HTTPS 直接開啟 callback。

redirect allowlist 正確後，保留 token response 的欄位形狀。先確認 relay 不在第一個 response 強制讀取 `user_id`：

```ts
const shortToken = requiredString(short.access_token);
// Do not require short.user_id here.
```

再檢查延長 token 和身份查詢是否使用固定的 Threads API host、固定 path 與受限 fields：

```text
POST /oauth/access_token
GET  /access_token?grant_type=th_exchange_token
GET  /v1.0/me?fields=id
```

## 根因

Meta 在授權前精確比對 redirect URI；填 App Domain 或 Website URL 不能取代 callback allowlist。不同 scheme、host、port、pathname、尾端斜線或 query 都可能不是同一個 URI。

另一個錯誤來自 relay 假設短期 token exchange 必定回傳 `user_id`。目前官方 Threads 範例會在取得 access token 後，以已授權 token 呼叫個人資料 endpoint，從該回應取得 ID。短期 response 缺欄位不代表授權失敗。

## 修正

在 Meta app 的 Threads OAuth 設定中：

- 開啟 Client OAuth Login 與 Web OAuth Login（若該設定頁提供）。
- 把實際 HTTPS callback 的完整字串加入 Valid OAuth Redirect URIs。
- 同時設定對應 App Domain 和 Website URL，但不要把它們當成 redirect allowlist 的替代品。

relay 改為以長期 token 讀取唯一需要的身份欄位：

```diff
 const shortToken = requiredUpstreamString(short.access_token, "access token");
-const userId = requiredUpstreamString(short.user_id, "Threads user ID");
const accessToken = requiredUpstreamString(long.access_token, "long-lived access token");
+const userId = await threadsUserId(accessToken);

 async function threadsUserId(accessToken) {
   const profile = await threadsRequest(
     graphUrl("me", { fields: "id", access_token: accessToken })
   );
   return requiredUpstreamString(profile.id, "Threads user ID");
 }
```

relay 只接受固定 origin、OAuth code、固定 Threads endpoints 與 bounded JSON；不記錄 code、access token 或 app secret。

## 驗證

- 以 production HTTPS callback 重新開始 OAuth，確認不再收到 `1349168`。
- Mock token exchange 時只回傳 `{ "access_token": "..." }`，確認 relay 仍會用長期 token 呼叫 `/me?fields=id`。
- 執行 PWA 型別檢查、connector 合約測試與 production build。
- 對 relay 執行 deploy dry-run，再部署 Worker；確認正式 connector 的設定端點仍可回傳 App ID，且不回傳 secret。
- 使用者在真實 Threads 帳號完成連接，確認 connection 已保存在該瀏覽器的本機 credential store。

## 下次先查

1. 先看錯誤是否發生在 Meta consent 前（redirect allowlist）或 callback 後（relay token parsing）。
2. 從 authorize URL 複製 `redirect_uri`，逐字比對 Meta 設定，包含尾端斜線。
3. token response 只保證實際文件列出的欄位；需要帳號 ID 時，以授權 token 查 `/me`。
4. 每次修正後重新發起 OAuth，絕不重用舊 authorization code。
