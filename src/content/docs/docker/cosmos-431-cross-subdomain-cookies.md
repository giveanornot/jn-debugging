---
title: Cosmos 431：跨子網域 Cookie 讓 Request Header Fields Too Large
description: A shared parent-domain cookie can make an unrelated subdomain exceed Cosmos Server's request-header limit and return HTTP 431.
date: 2026-08-02
tags:
  - cosmos
  - cookie
  - http-431
  - postiz
status: fixed
system: cosmos-server
severity: medium
aliases:
  - Request Header Fields Too Large
  - HTTP 431 Cosmos
  - cross subdomain cookie
---

## 快速結論

某個應用程式把登入 JWT 或 analytics cookie 設成父網域（例如 `.example.com`）時，瀏覽器會把它一併送到所有子網域。累積後，即使目標服務完全正常，Cosmos 也可能在轉送前以 HTTP `431 Request Header Fields Too Large` 拒絕請求。

不要先重建目標服務。先量實際 browser cookie，將來源應用的 cookie 改為 host-only，並移除既有的父網域 cookie。這比自製 Cosmos image 或調整不存在的設定安全且範圍小。

## 症狀

- 瀏覽器開啟某一個子網域時只看到：

```json
{"msg":"Error: Request Header Fields Too Large"}
```

- 無 cookie 的 `curl` 回應正常（常見為 `200` 或登入導向）。
- Cosmos access log 顯示該路由回 `431`。
- 問題只發生在某個既有瀏覽器 profile；無痕視窗或另一個 profile 正常。

## 影響範圍

- 入口：Cosmos Server reverse proxy
- 觸發端：任何將 cookie 設到父網域的 sibling application
- 受害端：同一個父網域下所有子網域
- 資料風險：低；這是 request 在 proxy 被拒絕，不代表目標服務或資料庫損壞

## 排查

先比較 cookie-less request 與真實 browser request。不要只看目標應用自己的 cookie；父網域 cookie 也會被送出。

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://comments.example.com/
```

在 browser DevTools 的 Storage / Application 面板，按網域列出 cookie 的：

- 名稱
- `Domain`
- 長度（只量名稱和值，不要輸出 session 或 JWT 值）
- 到期時間與 SameSite

再用合成 cookie 找出 proxy 的門檻，避免使用真實登入資訊：

```bash
padding=$(head -c 3500 /dev/zero | tr '\\0' x)
curl -sS -o /dev/null -w '%{http_code}\n' \\
  -H "Cookie: probe=${padding}" \\
  https://comments.example.com/
```

以數個長度重試，找出最後正常與第一個 `431` 的區間。此案例的 Cosmos 入口約在 4 KB request header 附近拒絕，實際值會依其他 request header 而異。

最後確認 cookie 的來源應用。典型訊號是：登入 `auth` JWT、PostHog 或 RudderStack persistence 都有 `.example.com` domain，卻被送到留言、wiki、監控等完全無關的子網域。

## 根因

Cookie 的 `Domain=.example.com` 代表瀏覽器必須將它送往 `*.example.com`。這不是 DNS 或 CORS 問題，而是瀏覽器的 cookie scope 規則。

Cosmos 會限制請求 header 大小，以防單一 request 消耗過多資源。當 `Cookie` header 加上一般瀏覽器 header 超過入口可接受大小時，request 不會抵達後端服務，因此重啟後端或清除它的 cache 沒有作用。

## 修正

將來源應用的應用程式 cookie 改成 host-only：設定 cookie 時不要傳 `Domain` 屬性。瀏覽器會把它限制在目前 hostname，例如 `social.example.com`，不會送到 `comments.example.com`。

```ts
// Before: shared with every sibling subdomain
response.cookies.set('auth', token, { domain: '.example.com' });

// After: host-only
response.cookies.set('auth', token);
```

analytics 也應避免跨子網域 persistence。以 PostHog 為例，可改用 localStorage 並關閉跨子網域 cookie：

```ts
posthog.init(key, {
  persistence: 'localStorage',
  cross_subdomain_cookie: false,
});
```

部署時加入一次性 migration：偵測到舊登入 cookie 的 request，回傳一個針對舊 `.example.com` domain 的過期 `Set-Cookie`，再讓使用者重新登入。只改新 cookie scope 不足以移除使用者 browser 中已存在的大型父網域 cookie。

```http
Set-Cookie: auth=; Max-Age=0; Path=/; Domain=.example.com; HttpOnly; Secure
```

若應用程式無法安全調整 cookie scope，才評估 proxy 是否支援 header limit 設定。先閱讀現用 Cosmos image 的設定與 source；不要假設有 Nginx 式 `large_client_header_buffers` 或可用的 `MaxHeaderBytes`。

## 驗證

- 來源應用 build 成功，並只重建該服務。
- 服務 process 均 online，公開入口對未登入 request 回正常登入導向。
- 送 synthetic old `auth` cookie 時，response 帶有針對父網域的過期 `Set-Cookie`。
- 使用者登入來源應用後，DevTools 顯示新 `auth` 沒有 `Domain` 屬性。
- 回到受害子網域，實際 browser request 不再回 `431`。

## 下次先查

遇到 Cosmos `431` 時：

1. 先用無 cookie `curl` 排除目標後端故障。
2. 檢查 browser 中父網域 cookie 的總大小與來源。
3. 用 synthetic padding 確認 proxy header 門檻。
4. 優先縮小 cookie scope、清舊 cookie；最後才研究 proxy 層上限。
