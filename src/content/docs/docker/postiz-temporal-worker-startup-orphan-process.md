---
title: Postiz 重啟後貼文卡 QUEUE，Temporal 沒有 worker
description: Postiz orchestrator 啟動時連不上 Temporal，PM2 仍顯示 online；重啟又留下占用 3002 的子程序，須清除殘留程序並驗證 task queue polling。
date: 2026-10-23
tags:
  - postiz
  - temporal
  - pm2
  - docker
  - nodejs
status: fixed
system: postiz
severity: high
aliases:
  - Postiz QUEUE no pollers
  - Temporal worker connection refused
  - orchestrator EADDRINUSE 3002
---

## 快速結論

Postiz 的 Docker container 與 PM2 都顯示正常，不代表發文 worker 有接收任務。這次在 Docker 重啟後，orchestrator 啟動時連不上 Temporal，之後沒有恢復 polling，貼文持續卡在 `QUEUE`。

確認 Temporal 可連線後恢復 orchestrator；若重啟出現 `EADDRINUSE :::3002`，先停止 PM2 管理的 orchestrator，再清除已確認的殘留子程序，最後重新啟動。驗收要看 task queue 的新 worker、backlog 與貼文結果。

本次完成服務恢復，尚未部署啟動等待或自動重連機制；下次重啟仍可能復發。

## 症狀

- 自架 Postiz v2.24.0，使用 Docker、PM2 與 Temporal。
- 頁面與公開 API 可用，container 持續運行，PM2 三個程序都顯示 `online`。
- 昨天與今天共九則貼文停在 `QUEUE`，沒有 `releaseURL`。
- Temporal container healthy，但 `main` task queue 沒有 poller，workflow backlog 持續累積。

啟動時的關鍵錯誤：

```text
[TemporalWorkerManagerService] Failed to create connection
TransportError: ... tcp connect error ... Connection refused
Failed to create worker connection, returning null
```

重啟後的第二個問題：

```text
Error: listen EADDRINUSE: address already in use :::3002
```

## 影響範圍

發文 worker 未接收任務，影響多個平台。已建立的 Temporal workflow 與貼文仍存在，不能從「沒有發出」推斷排程遺失。

恢復 worker 會讓舊任務繼續執行。先確認哪些逾期貼文仍要發，避免恢復後送出已過時內容；已送出但尚未完成記錄的任務，也需留意重複發文。

## 排查

以下範例假設 app container 名稱是 `postiz`、Temporal container 與可解析位址是 `temporal`。執行前換成自己的名稱。

先查貼文狀態與 integration，再查容器、PM2 和 Temporal。這次多個平台同時卡住，因此先沿共用 worker 路徑排查。

```bash
docker ps --format '{{.Names}} {{.Status}}'
docker exec postiz pm2 list
docker exec temporal temporal task-queue describe \
  --task-queue main --address temporal:7233
```

最有用的線索是 `Pollers` 空白，同時有積壓 workflow。再讀 orchestrator 啟動時的錯誤，確認 worker connection 曾被拒絕。PM2 online 與健康檢查可用，並未反映 worker 未註冊的狀態。

第一次只執行 `pm2 restart orchestrator`，出現連接埠占用與 restart count 增加。檢查程序父子關係後，發現原本由啟動包裝程序建立的 orchestrator 子程序仍存活。

映像沒有 `ps` 時，可從 `/proc` 精準比對參數，避免輸出完整命令列或環境變數。此部署使用的 entrypoint 如下；其他版本需先確認自己的路徑。

```bash
docker exec -i postiz node <<'JS'
const fs = require('fs');
const entrypoint = './dist/apps/orchestrator/src/main.js';
for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
  try {
    const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    if (!args.includes(entrypoint)) continue;
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    console.log({ pid, ppid: status.match(/PPid:\s+(\d+)/)?.[1] });
  } catch {}
}
JS
```

同一組程序可能包含 dotenv 包裝程序與真正的 Node.js app，不能單憑匹配數量認定重複。要比對父子關係與停止 PM2 後仍存活的程序。

## 根因

這次有兩層故障：

1. Docker 重啟後，orchestrator 建立 Temporal worker connection 時遭拒。日誌與無 poller 的 queue 證明 worker 未正常接收任務，程序卻繼續保持可用外觀。
2. PM2 重啟 orchestrator 時，舊的啟動包裝程序與 app 子程序殘留，占住 `3002`。新 app 註冊 worker 後又因監聽連接埠失敗而退出，形成重啟循環。

這些證據支持啟動時序與子程序清理問題；沒有證據顯示這九則貼文因資料庫遺失而卡住。

## 修正

### 先處理不再需要的舊貼文

本次使用者取消昨天五則，只保留今天四則。先 terminate 對應 workflow，再透過 Postiz API 刪除排程，最後重新查詢確認五則已移除。

```bash
docker exec temporal temporal workflow terminate \
  --workflow-id 'post_<post-id>' \
  --reason 'Cancelled by owner' \
  --address temporal:7233
```

不要僅改資料庫狀態或僅移除 UI 上的排程，就假定正在執行的 workflow 已停止。此版公開 API 的刪除方法固定回傳 `{ "error": true }`，即使刪除已完成；應以後續 GET 與 workflow 狀態驗證結果。

### 清除殘留程序，再啟動 orchestrator

本次修正層級是程序恢復，沒有重建映像或修改應用程式碼。

```bash
docker exec postiz pm2 stop orchestrator
```

重新執行上方 `/proc` 查詢，確認剩下的是 orchestrator 子程序。對每個已核對的 PID 先送 `SIGTERM`；仍殘留時才使用 `SIGKILL`。PID 每次都不同，不要沿用先前輸出的值。

```bash
docker exec postiz node -e 'process.kill(Number(process.argv[1]), "SIGTERM")' <confirmed-pid>
# 若重新檢查後，該程序仍未退出：
docker exec postiz node -e 'process.kill(Number(process.argv[1]), "SIGKILL")' <confirmed-pid>
```

確認殘留程序已退出，再啟動：

```bash
docker exec postiz pm2 start orchestrator
```

不要反覆 restart 來處理連接埠占用；本次這樣做會持續產生短暫註冊後退出的 worker。

## 驗證

恢復後檢查四件事：

- PM2 restart count 停止增加，程序持續運行。
- `/proc` 只剩預期的 orchestrator 包裝程序與 app 父子鏈，沒有額外殘留 app。
- `main` queue 出現目前 app PID 對應的 poller，workflow 與 activity backlog 都歸零。
- 逐則確認貼文狀態與 `releaseURL`，不能把 queue 歸零視為所有平台成功。

Temporal 查詢可能暫時仍列出已退出 worker 的歷史 poller；需配合 identity、LastAccessTime 與現存 PID 判斷。

本次今天的 Threads、Mastodon、Facebook 都成為 `PUBLISHED` 並取得公開貼文連結；X 為 `ERROR`。進一步檢查該則錯誤，確認是媒體上傳 API 回傳 `402 Payment Required / credits depleted`，屬於另一個平台額度問題，未加值或重新送出。

昨天五則已從 API 查詢結果消失，對應 workflow 已終止，取消時尚未發出。

## 下次先查

1. 查貼文 `QUEUE`、`ERROR`、`PUBLISHED` 與公開連結，先決定逾期內容是否仍要發。
2. 查 Temporal `main` queue 是否有近期 poller 與積壓任務。
3. 無 poller 時，找 orchestrator 啟動日誌的 connection refused。
4. 確認 Temporal 可用後恢復 worker；遇 `EADDRINUSE` 就查殘留子程序。
5. 用程序穩定度、目前 worker polling 與逐平台結果共同驗收。

後續若要避免復發，需另行實作並驗證啟動等待、worker 連線失敗後重試，以及能偵測「程序活著但沒有 polling」的健康檢查。本次尚未完成這些改動。
