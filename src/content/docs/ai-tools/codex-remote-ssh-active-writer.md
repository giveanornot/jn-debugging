---
title: Codex 手機 Remote 與 SSH 接手對話時出現 active writer
description: 手機與另一台桌面連到同一主機卻無法接續對話時，核對 app-server 程序與 writer lock，讓桌面 App 和 SSH 共用 Unix socket 後端。
date: 2026-10-26
tags:
  - codex
  - remote
  - ssh
  - linux
status: fixed
system: codex
severity: medium
aliases:
  - 已在另一個應用程式中開啟
  - This is open in another app
  - already has an active writer
  - Codex thread writer conflict
---

## 快速結論

連到同一台主機，仍可能使用不同的 Codex app-server。手機 Remote 使用主機桌面 App 自建的 stdio 後端，另一台桌面經 SSH 使用 Unix socket 後端時，兩個程序會競爭同一段對話的寫入鎖。

本次讓主機桌面 App 透過既有 Unix socket 連到 SSH 使用的後端，重開該桌面 App 後，手機與電腦能在同一段對話接續發訊息。修正經既有 Linux 安裝實測；使用的環境變數入口需隨版本重新查證，不能視為所有平台都有的設定。

## 症狀

另一台電腦看得到對話，但顯示：

```text
已在另一個應用程式中開啟
請先在該處關閉，才能在此處繼續。
```

主機日誌同時出現：

```text
failed to initialize thread persistence:
thread-store conflict: thread <id> already has an active writer
```

手機離開對話或關閉 App，不保證立刻釋放鎖；持有鎖的程序位於連線主機。

## 影響範圍

- 實測環境：Linux 主機桌面 App、Android Remote，以及另一台 Linux 桌面的 SSH 專案。
- 已安裝 App runtime：`26.1016.61520`；共用後端 CLI：`0.160.1`。
- 影響：無法從另一個 app-server 接續原對話；本次沒有刪除對話或修改專案資料。
- 需要區分手機控制端、連線主機，以及另一台桌面的連線方式。不能只看主機名稱相同就認定後端相同。

## 排查

1. 先核對實際 Connections 畫面。官方文件列有依平台與 rollout 提供的「Control other devices」，但本次控制端只有「控制此電腦」與「SSH」；不可直接要求切換不存在的頁籤。
2. 在連線主機比對 app-server 的 PID、父程序、`CODEX_HOME` 與傳輸方式。本次桌面 App 啟動獨立 stdio app-server，SSH 另連到 `--listen unix://` 的 app-server，兩者共用同一個 `CODEX_HOME`。
3. 用 `/proc/locks` 比對 `thread-writer-locks/<thread-id>.lock` 的 inode，定位實際持有鎖的 PID。空白 `.lock` 檔本身不代表鎖失效；不要靠刪檔解除。
4. 核對已安裝 App 的傳輸實作，確認 `CODEX_APP_SERVER_WS_URL` 可選用 WebSocket transport，且內含的 WebSocket client 支援 `ws+unix:`。
5. 以兩個獨立客戶端連到既有 socket，完成各自的 `initialize`，再對同一個閒置對話執行 `thread/resume`。不要只做 `thread/read`，也不要對已封存對話測試。

可透過該版本 CLI 產生相符的協定 schema：

```bash
codex app-server generate-json-schema --experimental --out /tmp/codex-schema
```

Unix socket 的初始化、`thread/resume` 與 Remote 狀態方法見 [Codex App Server 文件](https://learn.chatgpt.com/docs/app-server)。跨裝置與 SSH 的連線角色見 [Remote connections](https://learn.chatgpt.com/docs/remote-connections)。

## 根因

同一段對話的寫入鎖由 app-server 程序持有。兩個獨立 app-server 即使讀取相同的對話檔案，也不能同時成為 writer。

本次由程序與鎖的對照確認此情況；修改後原 GUI 後端退出、現有鎖集中到共用後端，兩個客戶端均能成功 resume。這些證據支持後端分離是本次衝突原因。

## 修正

修改層級為主機桌面 App 的啟動設定，未修改 `app.asar`、未新增 TCP listener，也未重啟正在服務 SSH 的後端。

先備份使用者 desktop entry、自啟動入口與原有 launcher。保留現有共用後端，再讓主機 GUI 使用其 socket。本次套件的最小啟動片段如下；App 執行檔位置應依已安裝套件確認：

```bash
#!/usr/bin/env bash
set -euo pipefail
shared_socket="${CODEX_HOME:-$HOME/.codex}/app-server-control/app-server-control.sock"
test -S "$shared_socket" || {
    printf '%s\n' 'Shared app-server socket is unavailable' >&2
    exit 1
}
export CODEX_APP_SERVER_WS_URL="ws+unix://localhost${shared_socket}:/rpc"
unset CODEX_APP_SERVER_FORCE_CLI
exec /usr/bin/codex-desktop "$@"
```

此處的 `localhost` 是 Unix WebSocket URL 的組成部分，連線使用既有 socket。範例適用於本次沒有空白或冒號的 socket 路徑。

將選單與自啟動入口指向同一個 wrapper，正常結束並重新啟動主機桌面 App。重開時保留原 profile；不要以讀取 Electron 執行中程序的 `cmdline` 原樣當成 argv，因程序標題可能已被改寫。也不要直接複用執行中 Electron 的環境內容，正常桌面 session 的必要環境變數可能已被移除。

本次 GUI 重開後 Remote 自動恢復 connected，原手機配對仍有效。只有配對實際失效時，才處理重新配對。

### 後端管理與回復

本次曾嘗試 CLI 的 `daemon enable-remote-control`，既有程序回報：

```text
app server is running but is not managed by codex app-server daemon
```

這表示該管理命令無法直接接管現有程序，不能據此推論現有 socket 不可共用。本次成功沿用既有程序，未做 managed daemon 遷移。

冷開機時誰先啟動共用後端，仍需另行驗證。CLI 提供 `app-server daemon bootstrap --remote-control` 等管理命令；使用前應查該版本說明，不能把本次 GUI 重開成功當成完整開機測試。

若需回復，還原備份的 launcher／desktop entry，移除新增的 WebSocket URL 設定，再正常重開主機桌面 App。不要刪除對話或 writer lock 檔案。

## 驗證

- 啟動腳本通過 `bash -n`，desktop entry 通過格式檢查。
- 從持久化入口真實重開 GUI，日誌顯示 `hostId=local transport=websocket` 且進入 `connected`。
- 原 stdio GUI 後端已退出，既有 SSH 後端保留；socket 權限為 `0600`。
- `remoteControl/status/read` 回報 `connected`，原 Android 配對保留。
- 兩個獨立客戶端 resume 同一段閒置對話，均成功且無 writer conflict。
- 主機 GUI 已用實際截圖驗收；使用者再從手機與另一台桌面，在同一段對話發送測試訊息並取得回覆。
- 跨裝置測試期間另有數次模型服務 `429 Too Many Requests`，稍後恢復，當下使用額度未觸頂。其根因未確定，不能把 writer lock 修復當成 429 已根治。
- 尚未實測整機冷開機、自動 bootstrap 路徑，以及未來版本升級後的相容性。

## 下次先查

1. 看錯誤是 writer conflict、模型服務限流，還是主機離線。
2. 明確畫出控制端、主機與各自 app-server 的關係。
3. 查鎖持有者與 GUI 實際 transport；再決定釋放舊程序或共用後端。
4. 用兩個獨立客戶端和兩個實際裝置驗證原對話，不只看程序存活或清單載入。
