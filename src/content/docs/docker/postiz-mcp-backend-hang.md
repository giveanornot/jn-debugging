---
title: Postiz MCP 造成 backend hang
description: Postiz scheduled posts stayed queued because MCP SSE requests accumulated and blocked backend work needed by Temporal activities.
date: 2026-03-25
tags:
  - postiz
  - mcp
  - temporal
  - nodejs
status: fixed
system: postiz
severity: high
aliases:
  - Postiz queued posts not publishing
  - api/mcp hang
  - Temporal activity timeout
---

## 快速結論

Postiz 排程文到時間仍停在 `QUEUE`，但手動 Post Now 可以發時，要檢查 backend 是否被長連線或 MCP endpoint 卡住。

這次根因是 Claude Code Postiz MCP 持續打 `/api/mcp/...` SSE endpoint，backend event loop 被 hang 住，Temporal activity worker 無法正常處理任務。移除 MCP 設定並重啟 backend/orchestrator 才根治。

## 症狀

- 到發文時間後，Postiz UI/API 仍顯示 `QUEUE`。
- 手動 Post Now 可以補發。
- Temporal activity 已 timeout 或沒有正常完成。
- backend 仍看似 alive，但排程任務不動。

關鍵線索：

```text
GET /api/mcp/<key>
Temporal activity timeout
```

## 影響範圍

- 服務：Postiz self-hosted
- 模組：backend、orchestrator、Temporal worker
- 影響：排程貼文不自動發出
- 資料風險：中；重複手動補發可能造成重複貼文

## 排查

先確認 scheduled posts 狀態：

```bash
curl -s "$POSTIZ_BASE/api/public/v1/posts?startDate=...&endDate=..." \
  -H "Authorization: $POSTIZ_API_KEY"
```

看 backend/orchestrator process 與 logs：

```bash
pm2 status
pm2 logs backend --lines 100
pm2 logs orchestrator --lines 100
```

如果 backend 看似在線，但一直有 MCP/SSE 長連線，檢查 agent 設定是否仍掛著 Postiz MCP。

Temporal 層確認是否 activity timeout 或 worker 沒處理：

```bash
docker logs temporal --tail 100
```

## 根因

`/api/mcp/...` SSE endpoint 會建立長連線。MCP client 持續重試或維持連線時，backend Node.js event loop 被拖住，Temporal activity worker 無法正常執行排程發文。

這不是單純「Temporal 壞掉」或「排程資料不見」。Post Now 能發，代表 provider token 與發文路徑仍可用；壞在自動排程 worker pipeline。

## 修正

停止造成長連線的 MCP client，並移除 agent 設定中的 Postiz MCP。

重啟 backend 與 orchestrator：

```bash
pm2 restart backend
pm2 restart orchestrator
```

若有殘留 backend child process 卡住，先確認不是正在處理重要任務，再終止：

```bash
ps aux | grep postiz
kill -9 <stuck-backend-child-pid>
```

已 timeout 的貼文不要等自動重試。用 UI 的 Post Now 或明確補發流程處理，並記錄哪些貼文已補發。

## 驗證

- MCP 設定已移除，agent 不再打 `/api/mcp/...`。
- `pm2 status` 顯示 backend/orchestrator online。
- 新排程文可在到期後自動發出。
- 舊 timeout 文已用 Post Now 補發，沒有重複貼文。

## 下次先查

Postiz 排程文卡 `QUEUE` 時：

1. 先確認 Post Now 是否可發。
2. 若可發，排除 provider token 與發文 API。
3. 查 backend/orchestrator logs。
4. 查是否有 MCP/SSE 長連線。
5. 查 Temporal worker 是否真的在 poll task queue。
