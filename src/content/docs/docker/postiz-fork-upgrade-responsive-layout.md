---
title: Postiz fork 升級後取得手機版面，保留 Plurk 與回復路徑
description: 從 Postiz v2.24.0 升到 v2.25.3，處理 Plurk refresh 與已移除 PostHog 的 cherry-pick 衝突，核對資料及 Temporal worker，並避開舊版 Prisma db-push 的回復風險。
date: 2026-10-27
tags:
  - postiz
  - docker
  - temporal
  - prisma
  - git
status: fixed
system: postiz
severity: medium
aliases:
  - Postiz mobile responsive upgrade
  - Postiz Plurk cherry-pick conflict
  - Postiz rollback Prisma db push
---

## 快速結論

本次自架 Postiz 使用 v2.24.0 加上 Plurk 與 Cookie 客製修補。[官方 v2.25.0](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.0) 加入一批響應式版面調整，因此將 fork 移植到查核當時最新的 v2.25.3，再建置及切換應用容器。

移植時保留新版 refresh 錯誤處理，不把上游已移除的 PostHog 模組加回。回復舊映像時，不能直接沿用會執行舊 Prisma `db push` 的啟動流程；本次另準備跳過 schema push 的 runtime override，保留新版新增欄位。回復方案只完成設定驗證，沒有實際執行。

## 症狀

手機版面支援不足。部署紀錄與實際容器映像均確認仍是 v2.24.0，尚未包含 v2.25.0 的這批 RWD 改善。本次沒有可接用的已登入瀏覽器，未重現特定手機畫面的溢出。

升級既有修補時遇到兩種衝突：

```text
CONFLICT (content): refresh.integration.service.ts
CONFLICT (modify/delete): helpers/posthog.tsx deleted in HEAD
```

## 影響範圍

自架 Docker 部署，包含前端、後端、orchestrator、PostgreSQL、Redis 與 Temporal。Plurk provider 與 host-only auth Cookie 是 fork 的既有差異，不能用官方映像直接覆蓋。

這次保留原上傳目錄 bind mount、資料庫及 Temporal stack，只重建應用容器。新版包含資料庫結構更新，必須先備份並保留舊映像。

## 排查

1. 先查官方 release，再以執行中的 image 與 source commit 確認版本。
2. 查看記憶體、swap 的 total／used／free 與根磁碟空間；空間不足時先確認可重建的 build cache，不刪服務資料或回復映像。
3. 備份 Compose、Postiz DB 與 Temporal DB，使用 `pg_restore -l` 確認 Postiz custom dump 可讀。
4. 建立獨立 worktree，依序 cherry-pick 客製 commits；不覆寫既有部署 checkout。
5. 記錄 integrations 的 ID／狀態、貼文數量、內容／日期／關聯的雜湊與狀態統計，供切換後比較；不輸出 token 或貼文本文。

透過 stdin 檢查備份時，`docker exec` 必須加 `-i`。本次第一次未加，出現 `input file is too short`；改用下列方式即可列出備份內容，不代表原 dump 損壞。

```bash
docker exec -i postgres pg_restore -l < postiz.dump
```

範例中的 container 名稱與路徑須依自己的部署替換。

## 根因

版面改善與本機部署版本有落差。移植衝突則來自兩項 upstream 變更：

- refresh service 新增錯誤原因記錄與通知去重，與既有 Plurk 長效 token fallback 改到同一區塊。
- PostHog helper 已被上游移除，但舊 Cookie 修補仍包含對該檔案的修改。

這兩種衝突不適合整段選擇 ours 或 theirs，否則會漏掉既有功能或恢復已刪除的上游模組。

## 修正

Plurk refresh 衝突保留既有 fallback，再接新版的錯誤記錄與共用通知處理。Cookie 修補保留 auth 的 host-only 設定及舊 domain cookie 清除邏輯；接受上游刪除 PostHog helper。

檢查 provider 新介面的預設實作、前端註冊入口與 DTO，完成 `git diff --check` 及相容性複查，再用新 tag 建置。此部署使用單階段 `Dockerfile.dev`，檔名雖含 dev，內容實際建置 production app；其他部署應先讀自己的 Dockerfile。

```bash
docker build --build-arg NEXT_PUBLIC_VERSION=<version-label> \
  -t localhost/postiz-app:<new-tag> -f Dockerfile.dev .
```

成功後再次備份並取資料基線，修改 Compose image，驗證設定，再只重建應用服務：

```bash
docker compose config -q
docker compose up -d --no-deps --force-recreate postiz
```

### 回復方案

本次 schema 差異主要是新增欄位、表、索引及允許 nullable 欄位。為避免舊啟動腳本重新套用舊 schema，另備 override：

```yaml
services:
  postiz:
    image: localhost/postiz-app:<old-tag>
    command: ["sh", "-c", "nginx && pnpm run --parallel pm2 && pm2 logs"]
```

這是針對本次映像中既有啟動 scripts 的 runtime 回復方案，不是所有 Postiz 版本通用的指令。使用前檢查舊映像的 scripts、schema 差異，以及升級後是否已有舊版無法處理的新資料。啟動時需同時帶入主 Compose 與 override；只用主 Compose 仍會啟動新版映像。

不要用升級前 dump 直接覆寫後來新增的使用者資料。資料庫回復是另一項需要備份與資料核對的操作。

## 驗證

- 前端、TypeScript、後端與 orchestrator 建置通過。
- schema 新欄位及新表可透過 Prisma 查詢。
- 14 個 integrations 與 1,515 則貼文的已記錄基線一致。
- `/auth` 與 integrations／posts 公開 API 回 200。
- PM2 三程序 online、restart count 為 0；新版 container 的 main／Plurk worker 持續 polling，backlog 為 0。
- 新版 CSS 可取得，包含 mobile utilities 與 media queries；這只證明資產已部署，沒有取代手機實際操作驗收。

首次 smoke 在 backend 尚未 ready 時，前端曾短暫回 500，日誌是 `ECONNREFUSED 127.0.0.1:3000`。待 backend 啟動完成後重跑同一請求成功，後續 60 秒無相同錯誤。這次沒有修改啟動時序，也沒有以測試貼文驗證對外發布。

## 下次先查

1. 確認實際 image、upstream 版本及 fork 差異，再判斷功能是否已部署。
2. 逐個檢查衝突的語意，接受上游移除的模組時確認剩餘引用。
3. 切換前後比資料基線，檢查目前 worker identity 與持續 polling；不要只看 PM2 online。
4. 區分啟動期間的短暫 500 與 ready 後仍持續的錯誤。
5. 回復前核對 schema 與 entrypoint；RWD 最後仍須手機實際操作驗收。
