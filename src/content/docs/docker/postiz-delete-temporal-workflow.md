---
title: Postiz 刪文後仍照排程發出
description: Postiz UI delete did not cancel the already-started Temporal workflow, so the workflow woke up and published stale post data.
date: 2026-05-12
tags:
  - postiz
  - temporal
  - workflow
status: fixed
system: postiz
severity: high
aliases:
  - delete post does not cancel workflow
  - postWorkflowV101
  - stale Temporal workflow
---

## 快速結論

Postiz 刪除排程文後仍發出時，先查 Temporal workflow。UI 的 delete 可能只 soft-delete DB row，沒有 cancel 已啟動的 workflow。

修法是在 workflow sleep 醒來後重新讀 post 狀態；若不再是 `QUEUE` 或已刪除，就直接 return。

## 症狀

- 使用者在 Postiz UI 刪除一篇排程文。
- 日曆上看起來已刪除。
- 到原本 publish time，貼文仍被發出。
- 同一時間可能造成重複發文或已取消內容外流。

## 影響範圍

- 服務：Postiz self-hosted / fork
- 模組：Temporal workflow、orchestrator
- 影響：已刪除排程仍可能發出
- 資料風險：高；使用者以為取消的內容會公開發出

## 排查

先確認該貼文是否曾建立 Temporal workflow：

```bash
docker exec temporal temporal workflow list --address temporal:7233
```

查 workflow id 是否類似 `post_<id>`。

確認 delete 後 DB state 與 workflow state 是否不一致：

- Postiz UI/API 已看不到或標成 deleted。
- Temporal workflow 仍 Running / Scheduled。

如果 workflow 仍在 sleep，到了 publish time 就可能醒來繼續跑。

## 根因

`postWorkflowV101` 在 workflow 啟動時只讀一次 post data，接著 sleep 到 publish date。sleep 期間如果使用者刪除貼文，workflow 醒來後沒有重新確認 `deletedAt` 或 state，直接使用舊資料發文。

這不是 provider 發文 API 自己重試，也不是 UI delete 失效；壞在 workflow lifecycle 沒有跟 DB 狀態重新同步。

## 修正

在 workflow sleep 之後、真正發文前，重新查 post：

```ts
const postsListAfterSleep = await getPostsList([...]);

if (!postsListAfterSleep[0] || postsListAfterSleep[0].state !== 'QUEUE') {
  return;
}
```

實際條件應依 Postiz 版本與 schema 同時檢查：

- row 是否仍存在
- `deletedAt`
- `state`
- publish date 是否仍符合

已存在的舊 workflow 若尚未發出，可手動 terminate：

```bash
docker exec temporal temporal workflow terminate \
  --workflow-id "post_<id>" \
  --address temporal:7233
```

## 驗證

- 建立測試排程文。
- 確認 workflow 已建立。
- 在 publish time 前刪除貼文。
- 等原 publish time 過後，確認沒有發出。
- workflow history 應顯示醒來後因 state 不符而結束。

## 下次先查

排程系統「UI 已刪、時間到仍執行」時，先查背景 scheduler/workflow 是否仍持有舊任務。

對 Temporal 類系統，不要只查 DB row；也要查 workflow list/history。
