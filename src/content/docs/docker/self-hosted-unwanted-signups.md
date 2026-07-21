---
title: 自架服務出現陌生帳號時的註冊封鎖與清理
description: Self-hosted services may expose a registration route by default; inventory accounts first, then disable registration at the supported setting or reverse proxy and verify the actual signup API.
date: 2026-07-21
tags:
  - docker
  - authentication
  - account-security
  - traefik
status: fixed
system: self-hosted-web-services
severity: high
aliases:
  - unexpected user registrations
  - disable self-hosted signup
  - block signup API with Traefik
---

## 快速結論

發現陌生帳號時，先保留自己的管理員帳號並盤點每個服務的使用者、建立時間與活動，再移除已確認的垃圾帳號。註冊功能優先用服務正式提供的設定關閉；沒有安全的應用程式設定時，才在反向代理精準攔截「建立帳號」的 API，並用實際 `POST` 驗證它已無法建立帳號。

只把登入頁藏起來不夠。自助註冊通常有獨立 API，直接呼叫它仍可能建立帳號。

## 症狀

- 原本只供個人使用的服務出現不認識的帳號。
- 登入頁仍有 Sign up / Register 入口，或公開註冊 API 可接受 `POST`。
- 不同服務的預設策略不一致：有些是公開註冊、有些是邀請制、有些只可由管理員建立使用者。

## 影響範圍

- Service：同一台 Docker host 上的自架 Web 服務。
- User-visible impact：垃圾帳號可占用資源，或在權限設定錯誤時取得資料存取權。
- Data risk：刪除帳號前必須確認其資料、組織關聯與實際活動；不要以「陌生」為唯一判斷直接刪除。

## 排查

先對每個服務分別確認帳號數與註冊模型，不要假設所有服務都有同一個環境變數。

```bash
# 先找出服務與實際 compose 專案，不輸出 env file 或含密碼的完整設定
docker ps --format '{{.Names}}\t{{.Image}}'
docker compose ps

# 對應服務的資料庫或管理介面：確認帳號、建立時間、最後活動與角色
# 只輸出必要欄位，避免把 email、hash 或 token 寫進 shell history / ticket
```

接著確認公開入口與實際建立帳號的 API 是否不同。對已知 signup API 送一個不完整 payload，只確認路由是否存在與驗證是否生效；不得用真實 email 測試建立帳號。

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST 'https://service.example/api/.../signup' \
  -H 'Content-Type: application/json' \
  --data '{}'
```

`400` 通常表示 API 存在但 payload 不完整；`404` 可能是路徑錯誤。不要把其中一個結果直接當成「已封鎖註冊」。

## 根因

自架映像常為第一次安裝方便而保留公開註冊，或升級後新增了可見的註冊入口。即使部分服務預設邀請制，其他服務仍可能獨立開放註冊，因此不能只做一次全機帳號盤點。

另一個常見誤判是只封鎖 `/signup` 前端頁面。帳號建立通常由後端 `POST` endpoint 完成，前端路由不存在不代表 API 失效。

## 修正

1. 先備份個別服務的 compose 或資料庫，再移除已確認的垃圾帳號與關聯資料。
2. 用官方的「Disable registration」或「Invite only」設定；保留現有 owner 的登入路徑。
3. 服務沒有可安全修改的註冊旗標時，在反向代理攔截精確的 signup API。
4. 需要保留公開註冊的服務，明確記錄例外，改以驗證信、CAPTCHA、rate limit 或人工審核降低濫用。

以下是 Traefik 的最小概念範例。實際 path 必須從該服務官方 API 文件或已驗證請求取得；不要猜測路徑。此範例把 signup 請求導回登入頁，讓既有登入與其他 API 照常通過。

```yaml
labels:
  - "traefik.http.routers.app.middlewares=block-signup@docker"
  - 'traefik.http.middlewares.block-signup.redirectregex.regex=^https?://app\.example/api/v1/auth/user/signup$'
  - "traefik.http.middlewares.block-signup.redirectregex.replacement=https://app.example/signin"
  - "traefik.http.middlewares.block-signup.redirectregex.permanent=false"
```

重新建立的範圍只限該服務：

```bash
cp docker-compose.yml "docker-compose.yml.pre-signup-lock-$(date +%Y%m%dT%H%M)"
docker compose config -q
docker compose up -d --no-deps --force-recreate app
```

如果反向代理支援直接回應 `403`，對 API 會比 redirect 更清楚；不論採用哪一種，都要確認它在代理層生效而不是只改到未被公開流量使用的容器。

## 驗證

- `docker compose config -q` 通過，且只有目標服務被重新建立。
- 公開首頁與既有登入頁回應正常。
- 對精確 signup API 的無效 `POST` 不再抵達應用程式；例如回應 `403` 或由代理重新導向。
- 再次盤點帳號，確認只剩預期帳號；不因測試多出帳號。
- 若服務啟動時暫時回 `502`，等待 application ready 後再驗證，避免誤判代理規則壞掉。

## 下次先查

1. 先確認陌生帳號是否真的有活動與資料關聯。
2. 查該服務的官方註冊設定與實際 signup API。
3. 先備份，再只重建目標服務。
4. 同時驗證「signup 被擋」和「首頁／登入仍正常」。
