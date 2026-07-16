---
title: Browser Extension 連線診斷
description: Browser automation extension backend 連不上 Chrome/Brave 時，先區分 profile、GUI env、extension、native host manifest。
date: 2026-07-16
tags:
  - browser-automation
  - chrome
  - native-host
status: fixed
system: desktop
severity: medium
aliases:
  - extension backend
  - Chrome native host
  - No Codex browser client is connected
  - Codex Chrome Extension
---

## 快速結論

不要把「Chrome 開不起來」直接判定為 extension 壞掉。先分開檢查 profile 選擇、圖形環境變數、extension 安裝狀態與 native host manifest。

這類問題通常不是單點故障，而是「瀏覽器有開、extension 有裝、native host 有登記、agent 有拿到 GUI session」其中一段斷掉。先切層，比重裝快很多。

## 症狀

local AI agent 無法連到 extension backend，browser automation 沒有可用 tools。

常見表現：

- agent 顯示 browser backend disconnected。
- Codex Chrome Extension 顯示 `No Codex browser client is connected`。
- helper 等待 extension connect 到 timeout。
- Chrome/Brave 看似開了，但 agent 讀不到 tab。
- 換瀏覽器 profile 後 extension 消失。
- 從 terminal 開 browser 正常，從 agent app 開卻抓不到 GUI session。

### 「No Codex browser client」分支

這個畫面表示瀏覽器 extension 沒有連上 desktop app 的 browser client；它不等於 native host manifest 一定壞掉。常見情況是 browser 尚未啟動、開錯 profile，或 desktop app / task 的連線狀態已失效。

先用最短路徑恢復，不要立刻重裝：

1. 完全關閉 browser 與 desktop app。
2. 先開 desktop app，確認 Browser / Chrome plugin 已啟用。
3. 再開有安裝 extension 的同一個 browser profile，從工具列確認 extension 顯示 **Connected**。
4. 開新 task 後，先讀取一個現有分頁來驗證。

若仍未連上，才回到 profile、native host manifest 與 GUI session env 的排查。

## 影響範圍

- local AI agent desktop app
- Chrome / Brave
- browser automation
- browser helper

不直接影響網站資料本身，但會讓需要登入 session 或現有分頁的 automation 失效。

## 排查

- 確認 Chrome 已安裝。
- 確認 extension 已安裝且啟用。
- 確認 native host manifest 路徑正確。
- 確認 helper 沒誤選空 profile。
- 補齊 `HOME`、`DISPLAY`、`XDG_RUNTIME_DIR`、`DBUS_SESSION_BUS_ADDRESS`。

建議排查順序：

```bash
command -v google-chrome chromium brave-browser
```

先確認實際會被 helper 呼叫的是哪個 browser binary。接著檢查 native messaging host manifest 是否存在於該 browser 會讀的位置。

```bash
find ~/.config -path '*NativeMessagingHosts*' -type f
```

如果 extension 確定存在，但 agent 仍連不上，下一步才檢查 GUI session env。從桌面 app 或 service 啟動的 process 很常缺這些環境變數。

```bash
printf 'HOME=%s\nDISPLAY=%s\nXDG_RUNTIME_DIR=%s\nDBUS_SESSION_BUS_ADDRESS=%s\n' \
  "$HOME" "$DISPLAY" "$XDG_RUNTIME_DIR" "$DBUS_SESSION_BUS_ADDRESS"
```

最後檢查 profile。不要只看「瀏覽器有開」；要確認打開的是有安裝 extension 的 user data dir。

## 根因

helper 預設選到空 Brave profile，且 GUI session 需要的環境變數不完整。在另一個常見分支中，extension 和 native host 都已安裝，但 desktop app 的 browser client 尚未和目前 browser session 建立連線。

所以 extension backend 不是壞掉；它只是沒有在 agent 能控制的那個 profile/session 裡運作。

## 修正

指定正確 Chrome user data dir，並補齊 GUI session env 後再啟動瀏覽器。若是 browser client 未連線分支，先以「desktop app → 同 profile browser → 新 task」的順序重建連線。

修正方向：

```bash
export CODEX_CHROME_USER_DATA_DIR="$HOME/.config/google-chrome"
export HOME="$HOME"
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
```

實際值依桌面環境調整；不要把這段當成固定可複製設定。重點是讓 helper 跟使用者正在登入的 GUI session 對齊。

## 驗證

- extension backend 連線成功。
- browser automation 可讀取目前分頁。
- browser helper 可跑出候選資料並落盤 JSONL。
- Chrome extension 的可用分頁清單不再是空的。

驗證時要分兩層：

- backend connected：agent 有拿到 browser tools。
- browser usable：可以讀目前 tab、點擊、擷取文字，且資料能落盤。

只看到 connected 不代表 workflow 已恢復；至少跑一個最小查詢或讀頁測試。

## 下次先查

先檢查 profile 與 GUI env，再檢查 extension/native host。不要直接重裝整套瀏覽器工具。

最短路徑：

1. 確認 helper 用哪個 browser binary。
2. 確認該 profile 有 extension。
3. 確認 native host manifest 存在。
4. 確認 agent process 有 GUI env。
5. 再重啟 browser helper。
