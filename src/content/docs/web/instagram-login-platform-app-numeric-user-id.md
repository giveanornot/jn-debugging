---
title: Instagram Login 拒絕 platform app，或 OAuth user ID 是數字
description: An Instagram Business Login integration can fail when it uses the generic Meta App ID instead of the Instagram App ID, then reject Meta's numeric preliminary user_id during token exchange.
date: 2026-08-16
tags:
  - instagram
  - meta
  - oauth
  - pwa
  - cloudflare-worker
status: fixed
system: instagram-api
severity: medium
aliases:
  - Invalid platform app
  - Instagram did not return a valid Instagram user ID
  - Instagram Business Login App ID
  - Instagram OAuth numeric user_id
---

## 快速結論

Instagram API with Instagram Login 有自己的 **Instagram App ID** 與 App Secret；不要把 Meta App 基本設定的通用 App ID 或 Threads App ID 用於 `instagram.com/oauth/authorize`。否則授權頁會回 `Invalid platform app`。

OAuth code exchange 的暫時 `user_id` 也可能是 JSON number，Instagram ID 可超出 JavaScript 安全整數範圍。不要轉型或持久化它；只取 access token，接著用長期 token 的 profile request 取得可發布帳號的字串 ID。

## 症狀

按下 PWA 的「連接 Instagram」後，授權頁在登入前顯示：

```text
Invalid request: Request parameters are invalid: Invalid platform app
```

App ID 換成 Instagram 專用 ID 後，授權可以完成，但 callback 又顯示：

```text
Instagram did not return a valid Instagram user ID.
```

## 影響範圍

- Service：使用 Instagram API with Instagram Login 的 browser PWA 與最小權限 OAuth relay。
- 使用者影響：無法建立本機 Instagram connection；不會發出貼文。
- 資料風險：低；失敗發生在 connection 初始化前，token 不應存到伺服器或可攜匯出資料。

## 排查

先確認授權 URL 的 host、App ID 和 scopes 都屬於 Instagram Login：

```text
https://www.instagram.com/oauth/authorize
  ?client_id=<instagram-app-id>
  &redirect_uri=https://publisher.example/
  &response_type=code
  &scope=instagram_business_basic,instagram_business_content_publish
```

在 Meta Developer Dashboard 的「Instagram → API setup with Instagram login」確認：

- `client_id` 是畫面上標示的 **Instagram App ID**，不是通用 App ID。
- App Secret 也來自同一個 Instagram 設定頁。
- OAuth redirect URI 與 request 完全相同，包含 HTTPS、pathname 和尾端斜線。
- 測試帳號已接受 app role，且帳號是 Professional（Creator 或 Business）。

`Webhooks` callback URL 不是 OAuth redirect URI。未使用 Instagram Webhooks 時不要啟用 subscription，也不要為 OAuth 填入 webhook 設定。

若 consent 已成功，保留 token exchange response 的原始欄位型別。尤其不可把大型 ID 強制轉成 JavaScript `number` 後再轉回字串：

```json
{
  "access_token": "…",
  "user_id": 1784
}
```

## 根因

Meta app 可同時有通用、Threads 與 Instagram 的不同 App ID。Instagram Login 只接受 Instagram product 產生的 ID；錯誤的 ID 在 consent 前就會被拒絕，與 secret 或 redirect URI 無關。

第二個錯誤來自 relay 把 OAuth code exchange 的 `user_id` 當成必要字串。這個暫時欄位不是 Good POSSE 的可信帳號識別來源，而且 numeric JSON ID 可能超過 `Number.MAX_SAFE_INTEGER`。真正需要用於發文的 Professional account ID 應由已授權 token 的 profile endpoint 取得。

## 修正

在 Worker 的 secret 設定中，使用 Instagram 設定頁的同一組值：

```text
INSTAGRAM_APP_ID=<Instagram App ID>
INSTAGRAM_APP_SECRET=<Instagram App Secret>
```

把 PWA callback 加到「設定 Instagram 商家登入」的 OAuth redirect URI allowlist：

```text
https://publisher.example/
```

relay 不再在 code exchange 階段驗證或回傳暫時 `user_id`，只交換長期 token；後續 profile lookup 才取得可發文 ID：

```diff
 const shortToken = requiredUpstreamString(short.access_token, "access token");
-const userId = requiredUpstreamString(short.user_id, "Instagram user ID");
// Do not coerce or persist the preliminary OAuth user_id.
 const accessToken = requiredUpstreamString(long.access_token, "long-lived access token");
+const profile = await graphRequest(accessToken, "me", { fields: "user_id,username" });
+const userId = requiredUpstreamString(profile.user_id, "Instagram professional account ID");
```

relay 仍只接受固定 origin、OAuth code、固定 Instagram endpoints 和受限 request schema；不記錄 access token 或 app secret。

## 驗證

- 以正確 Instagram App ID 從 production PWA 重新開始 OAuth，確認不再出現 `Invalid platform app`。
- Mock token exchange 的 `user_id` 為數字，確認 relay 仍能完成長期 token exchange。
- 執行 PWA 型別檢查、core contract、Instagram Worker contract 與 production build。
- 部署 relay 後，以允許的 Origin 呼叫 connector config，確認只回傳 Instagram App ID，不回傳 secret。
- 使用 Professional test account 完成連接，確認 Instagram connection 與 credential 僅保存在該瀏覽器的本機 store。

## 下次先查

1. 若錯誤發生在 consent 前，先比較 Instagram App ID、authorize host 和 OAuth redirect URI。
2. Dashboard 裡優先讀「Instagram API with Instagram Login」頁面的 ID／secret，不用其他 product 的憑證。
3. 若 error 發生在 callback 後，檢查 relay 是否假設 token response 的 `user_id` 型別或存在性。
4. 修正後重新發起 OAuth；authorization code 不可重用。
