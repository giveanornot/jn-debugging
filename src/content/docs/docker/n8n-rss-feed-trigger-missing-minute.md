---
title: n8n 2.x RSS Feed Trigger 沒有輪詢：補齊 minute 並重新發布
description: 升級到 n8n 2.x 後，舊的 everyHour RSS polling 設定若缺少 minute，會產生無效 cron，工作流雖顯示啟用卻不會自動執行。
date: 2026-09-30
tags:
  - n8n
  - docker
  - rss
  - scheduler
  - newsletter
status: fixed
system: n8n
severity: medium
aliases:
  - n8n RSS Feed Trigger not polling
  - n8n everyHour missing minute
  - n8n workflow active but RSS trigger does not run
---

## 快速結論

n8n 2.x 的 RSS Feed Trigger 若沿用舊資料，只存了 `{"mode":"everyHour"}` 而沒有 `minute`，排程會解析成像 `25 undefined * * * *` 的無效 cron。工作流可能仍顯示 active，重啟也沒有明顯錯誤，但不會自動輪詢或寄信。

把已發布版本的 RSS `pollTimes` 明確存成 `{"mode":"everyHour","minute":0}`，重新發布並重啟 n8n。不要把「沒有 execution」當作唯一證據：RSS 沒有新項目時會正常回傳 `null`，不建立 execution。

## 症狀

- RSS Feed Trigger 的工作流顯示已啟用，但新文章沒有觸發後續寄信或其他動作。
- n8n 重啟後服務健康，卻看不到這個 RSS trigger 實際排程。
- 手動執行工作流可成功抓取文章、執行下游節點；只有自動輪詢失效。
- 已發布工作流的節點資料含有：

```json
{
  "pollTimes": {
    "item": [{ "mode": "everyHour" }]
  }
}
```

## 影響範圍

- 服務：Docker Compose 上的 n8n 2.x
- 元件：`RSS Feed Trigger` 的 polling workflow
- 使用者影響：新文章不會自動進入電子報或其他下游工作流
- 資料風險：低；RSS trigger 初始輪詢以目前時間當基線，因此修復後不應追送舊文章

## 排查

先確認 RSS 本身仍有最新項目，再把「來源不可讀」與「排程沒有註冊」分開：

```bash
curl -fsS 'https://example.invalid/index.xml' | head
docker compose ps
docker compose logs --since=15m n8n
```

在 n8n UI 或以已授權的 API/CLI 匯出**已發布版本**，檢查 RSS 節點的實際 JSON。不要只看 UI 顯示的「Every Hour」；有些舊版本資料會省略 `minute`。

```json
{
  "mode": "everyHour",
  "minute": 0
}
```

這是關鍵差異。n8n 的 cron 轉換在缺少 `minute` 時會保留 `undefined`，而非可靠地補預設值：

```text
{ mode: "everyHour" }            -> <second> undefined * * * *
{ mode: "everyHour", minute: 0 } -> <second> 0 * * * *
```

檢查重啟後的啟用日誌；健康檢查只代表 HTTP 服務可用，不代表 polling 已註冊：

```bash
docker compose restart n8n
docker compose logs --since=5m n8n | grep -F 'Activated workflow'
```

## 根因

升級前保存的 `everyHour` polling 參數少了新版排程程式實際需要的 `minute` 欄位。n8n 將這個舊 payload 轉成 cron 時得到無效欄位，因此沒有建立可執行的 RSS 輪詢。

「工作流 active」是資料庫狀態，不等於每一個 trigger 都已註冊。若 RSS 沒有新項目，poll node 也會回傳 `null`，所以 execution 清單空白不能單獨證明哪一層故障。

不要把實驗性的 scheduler / workflow-publication feature flag 當成萬用修法。它們的可用組合隨 n8n 版本而變；先在測試或受控環境確認 RSS poll job 已建立，再改正式環境。這次事件中，回到預設的穩定 trigger 啟動路徑並修正 payload 才恢復註冊。

## 修正

透過 n8n UI 或已授權的 API 更新 RSS 節點，並確認儲存後的**已發布版本**確實含有 `minute: 0`：

```json
{
  "pollTimes": {
    "item": [{ "mode": "everyHour", "minute": 0 }]
  }
}
```

重新發布這個版本。若用 CLI 發布，依輸出提示重啟正在運行的 n8n，讓它載入新版本：

```bash
docker compose exec -T n8n n8n publish:workflow --id=<workflow-id>
docker compose restart n8n
```

不要直接在 SQLite 中只改 `workflow_entity.versionId` 或節點 JSON。n8n 發布流程依賴對應的 workflow history/version snapshot；應使用 UI、API 或受支援的 CLI 流程建立版本，再發布。

## 驗證

- `docker compose config -q` 通過，n8n `/healthz` 回 `{"status":"ok"}`。
- 已發布版本和 active version 一致，且 RSS `pollTimes.item[0]` 有 `minute: 0`。
- cron 解析為六欄且第二欄是 `0`，例如 `25 0 * * * *`；秒數可能因工作流而不同。
- 容器重啟後，log 出現對應 workflow 的 `Activated workflow`。
- 手動執行可驗證 feed 和下游寄送設定；真正端到端驗證仍要等下一個新 RSS 項目，確認只建立一次 trigger execution。

## 下次先查

1. 先抓原始 RSS，確認有最新 item。
2. 匯出已發布 workflow，檢查 `everyHour` 是否明確含 `minute`。
3. 檢查解析出的 cron，不接受含 `undefined` 的結果。
4. 發布後重啟 n8n，從 log 確認 workflow 已重新啟用。
5. 等新的 RSS item 驗證 trigger execution；沒有新項目時，空 execution 是正常現象。
