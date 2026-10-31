---
title: Browser Extension 連線診斷
description: Chrome/Brave extension 連線或 Page.navigate 逾時時，分開檢查 profile、GUI env、App、MCP browser service 與 native host 版本。
date: 2026-10-31
tags:
  - browser-automation
  - chrome
  - native-host
status: investigating
system: desktop
severity: medium
aliases:
  - extension backend
  - Chrome native host
  - No Codex browser client is connected
  - Codex Chrome Extension
  - Page.navigate timeout
  - Computer use
---

## 快速結論

若 extension 顯示已連線、可讀空白分頁，卻連一般網站的 `Page.navigate` 都固定逾時，還要檢查 desktop app、MCP browser service 與 native host 的實際版本。本次修復組合是更新 Community app、移除 MCP 設定中的舊版固定值，再由 App 的 **設定 → Computer use** 重新設定 Chrome；三層對齊後導覽與搜尋恢復。

若 agent 啟動 Chrome 出現 profile 唯讀與 SUID sandbox helper fatal，先比對本聊天實際套用的沙盒權限與全域預設；全域設定不代表已套用。本案例使用者調整有效權限後，同一啟動命令恢復，沒有重裝 extension 或停用 Chrome sandbox。

不要把「Chrome 開不起來」直接判定為 extension 壞掉。先分開檢查 profile 選擇、圖形環境變數、extension 安裝狀態、native host manifest，以及啟動器實際選到的瀏覽器。

這類問題通常不是單點故障，而是「瀏覽器有開、extension 有裝、native host 有登記、agent 有拿到 GUI session、啟動器指向正確 browser/profile」其中一段斷掉。先切層，比重裝快很多。

## 症狀

local AI agent 無法連到 extension backend，browser automation 沒有可用 tools。

常見表現：

- agent 顯示 browser backend disconnected。
- Codex Chrome Extension 顯示 `No Codex browser client is connected`。
- helper 等待 extension connect 到 timeout。
- Chrome/Brave 看似開了，但 agent 讀不到 tab。
- 換瀏覽器 profile 後 extension 消失。
- 從 terminal 開 browser 正常，從 agent app 開卻抓不到 GUI session。
- Chrome profile 的 extension 與 native host 都正常，但 agent 的啟動器改去尋找另一個不存在的 Brave profile。
- fallback helper 回報 `No connection to browser extension`，因此無法補跑依賴既有登入 session 的工作。

### 「No Codex browser client」分支

這個畫面表示瀏覽器 extension 沒有連上 desktop app 的 browser client；它不等於 native host manifest 一定壞掉。常見情況是 browser 尚未啟動、開錯 profile，或 desktop app / task 的連線狀態已失效。

先用最短路徑恢復，不要立刻重裝：

1. 完全關閉 browser 與 desktop app。
2. 先開 desktop app，確認 Browser / Chrome plugin 已啟用。
3. 再開有安裝 extension 的同一個 browser profile，從工具列確認 extension 顯示 **Connected**。
4. 開新 task 後，先讀取一個現有分頁來驗證。

若仍未連上，才回到 profile、native host manifest 與 GUI session env 的排查。

### 已連線但 Page.navigate 持續逾時

另一種失敗模式是 extension 與 native host 均在執行，agent 可建立、讀取或截圖 `about:blank`，但導覽一般網站與登入中的服務都固定約 10 秒逾時。完整重啟 Chrome 仍可重現。這與「完全沒有 browser client」是不同分支。

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

先確認實際會被 helper 呼叫的是哪個 browser binary。若系統同時安裝 Chrome 與 Brave，還要比對「設定選到的 browser」和「啟動器實際查詢的 profile 目錄」是否一致；不要只檢查 Chrome profile 本身。

```text
Could not find a Chrome profile directory with Preferences in .../Brave-Browser
```

這類訊息表示啟動器已經選錯 browser/profile 路徑。此時即使 Chrome Default profile 裡的 extension 和 native host manifest 都存在，也不會恢復連線。

接著檢查 native messaging host manifest 是否存在於目標 browser 會讀的位置。

```bash
find ~/.config -path '*NativeMessagingHosts*' -type f
```

如果 extension 確定存在，但 agent 仍連不上，下一步才檢查 GUI session env。從桌面 app 或 service 啟動的 process 很常缺這些環境變數。

```bash
printf 'HOME=%s\nDISPLAY=%s\nXDG_RUNTIME_DIR=%s\nDBUS_SESSION_BUS_ADDRESS=%s\n' \
  "$HOME" "$DISPLAY" "$XDG_RUNTIME_DIR" "$DBUS_SESSION_BUS_ADDRESS"
```

最後檢查 profile。不要只看「瀏覽器有開」；要確認打開的是有安裝 extension 的 user data dir。

### Chrome 未執行，啟動器缺少 DISPLAY

extension 已安裝且啟用、native host manifest 正確，仍可能沒有可連線的 Chrome。2026-10-31 案例中，官方 running check 回報未執行；授權後使用 plugin 啟動器卻得到：

```text
Missing X server or $DISPLAY
The platform failed to initialize. Exiting.
```

這表示此次 Chrome 啟動失敗在圖形環境層，不能推定 extension 損壞。先確認現有桌面與 user manager 所知的環境：

```bash
ls -la /tmp/.X11-unix
systemctl --user show-environment | rg '^(DISPLAY|XAUTHORITY|XDG_RUNTIME_DIR)='
```

本例已有 X11 socket，user manager 提供 `DISPLAY=:0.0` 與現有使用者的 `XAUTHORITY`。僅把查到的兩個值傳給官方 Chrome plugin 的 `scripts/open-chrome-window.js --browser chrome`，沿用已安裝 extension 的原 profile，Chrome 與 browser-client 即恢復。

不要猜 display number、整批 `eval` user manager 環境、變更 HOME、改 profile 或以 `--no-sandbox` 繞過。啟動仍須依當輪 plugin 規定取得使用者授權；本例已有授權，不需再次詢問。Wayland 環境須另依實際桌面定位，不套用此 X11 值。

本輪根檔案系統曾滿載並出現 `ENOSPC`／Goal `disk I/O error`，清除可重新下載的更新包後恢復寫入，稍後又擴容。磁碟與 GUI 啟動問題分開驗證；沒有證據顯示磁碟清理直接修好了 extension。較早出現的 `Debugger unattached`／導覽逾時也未定位單一根因。

### 比對 App、MCP 與 native host 版本

本次觀察到以下順序：

1. extension 已啟用、native host manifest 存在，空白頁操作成功；一般網站與搜尋頁導覽都逾時。
2. Community app 更新至 `2026.10.22.065504`（upstream `26.1016.61520`）。
3. MCP 的 `NODE_REPL_TRUSTED_SERVICES` 仍指向舊 browser service，`BROWSER_USE_CODEX_APP_VERSION` 仍固定為 `26.1002.52244`；改成目前安裝來源及對應版本後熱載入，導覽仍失敗。
4. native host registry 仍只有 `26.1002.52244`；App 更新沒有同步刷新這一層。
5. 使用者從 Community **設定 → Computer use** 重新設定 Chrome 後，registry 才更新至 `26.1016.61520`，導覽恢復。

先從實際安裝來源與目前 MCP 設定定位檔案，再讀 native host manifest／registry 所指向的版本。上述數字是本次案例值，不是往後應固定使用的最新版。不要只憑 extension Connected 判定各層都已更新，也不要手改 registry 冒充完成安裝。

### Agent 沙盒阻擋 Chrome 啟動

此分支的 extension 已安裝／啟用，native host manifest 也通過檢查，但啟動 Chrome 直接 exit 133，關鍵錯誤為：

```text
Crash Reports/settings.dat: Read-only file system
SUID sandbox helper ... fatal
```

檢查 agent 執行環境的 profile 掛載、程序限制與本聊天有效權限：

```bash
findmnt -T "$HOME/.config/google-chrome" -o TARGET,OPTIONS
awk '/NoNewPrivs|Seccomp/ {print}' /proc/self/status
```

本案例全域設定為 danger-full-access，但聊天實際仍是 managed workspace-write；profile 所在掛載唯讀且有 nosuid，程序也受額外限制。這支持「本輪啟動環境阻擋」的判斷，不能由 sandbox 的程序清單推定宿主沒有 Chrome。

使用者調整聊天有效權限後，以相同 GUI session env 啟動成功，extension 連線且搜尋、讀文、捲動均正常。未確認是哪一個 App／managed 設定選用了先前權限；不將此案例泛化成所有 Chrome 啟動失敗都要開放完整權限。應由使用者依信任範圍選擇權限，或從正常桌面啟動，勿以 `--no-sandbox` 繞過。

#### 設定已改，同一回合仍受限制

2026-10-26 再次遇到同樣症狀。使用者在進行中的回合調整權限後，該回合仍維持舊限制；下一個完整回合才實際取得新的有效權限：

| 檢查項目 | 失敗回合 | 恢復回合 |
| --- | --- | --- |
| 全域設定 | `danger-full-access` | `danger-full-access` |
| 聊天有效權限 | managed `workspace-write` | `danger-full-access` |
| profile 掛載選項 | `ro,nosuid,nodev` | `rw` |
| `NoNewPrivs` | `1` | `0` |
| `Seccomp` | `2` | `0` |
| 同一官方啟動器與 GUI env | profile 唯讀／SUID helper 中止 | Chrome 啟動、extension 連線與搜尋成功 |

這是本案例的前後對照，不是要求其他環境必須停用程序限制。看到使用者說「已調整」時，應先重讀當輪有效權限與實際啟動結果；尚未更新就明示仍在舊回合，不要求使用者反覆修改相同設定。新回合仍需做最小讀頁／搜尋驗證，不能只看到設定值便宣稱恢復。

尚未定位選用舊權限的具名 App／managed 設定來源，也未證實新聊天預設會永久沿用此次權限。再次發生時先比對這組證據，不重裝 extension、不反覆啟動 fallback helper。

## 根因

已觀察到以下可獨立發生的分支：

- agent 啟動器查詢 Brave profile，但實際可用的 extension 安裝在 Chrome Default profile；這是 browser/profile routing 不一致。
- extension 和 native host 都已安裝，但 desktop app 的 browser client 尚未和目前 browser session 建立連線；fallback helper 因而回報 `No connection to browser extension`。

- App 更新後，MCP browser service／app version 仍固定舊值，native host 也保留舊版本。更新並重新設定後，本次導覽逾時已修復；因未逐個元件獨立回退測試，無法斷言是哪一個舊元件單獨造成故障。

本頁保留 `investigating`，因較早的 profile routing 分支仍缺獨立驗收；不代表本次導覽逾時仍未修復。

## 修正

先修正啟動器的 browser/profile routing，讓它指向有 extension 的 Chrome user data dir；再補齊 GUI session env 後啟動瀏覽器。若是 browser client 未連線分支，先以「desktop app → 同 profile browser → 新 task」的順序重建連線。

修正方向：

```bash
export CODEX_CHROME_USER_DATA_DIR="$HOME/.config/google-chrome"
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
```

實際值依桌面環境調整；不要把這段當成固定可複製設定。重點是讓啟動器、helper 與使用者正在登入的 GUI session 都指向同一個 browser/profile。若啟動器仍查另一個 browser 的 profile，先修正該 routing，再重試 extension 連線。

### 版本落後的修復分支

- **App 層**：透過既有更新機制更新 Community，確認 updater 回到正常狀態。
- **MCP 設定層**：先備份設定，再將 browser service 路徑及 app version 對齊目前實際安裝版本；信任目錄只保留所需的官方來源，重新載入 MCP。
- **Native host 層**：若 registry 仍是舊版，由使用者在 App 的 **設定 → Computer use** 重新設定 Chrome，再確認 host 版本與連線狀態。

不要把案例中的套件路徑或版本直接複製到其他安裝；先確認本機發行方式與實際檔案。

## 驗證

- 啟動器解析到正確 browser 的 profile，且不再出現另一個 browser 的 `Preferences` 路徑錯誤。
- extension backend 連線成功。
- browser automation 可讀取目前分頁。
- browser helper 可跑出候選資料並落盤 JSONL。
- Chrome extension 的可用分頁清單不再是空的。

驗證時要分兩層：

- backend connected：agent 有拿到 browser tools。
- browser usable：可以讀目前 tab、點擊、擷取文字，且資料能落盤。

只看到 connected 不代表 workflow 已恢復；至少跑一個最小查詢或讀頁測試。

### 本次版本修復的實測

- 重新設定後 native host registry 為 `26.1016.61520`。
- 一般網站約 1.4 秒完成導覽，並可讀取頁面文字。
- Threads recent 搜尋頁約 2.2 秒完成導覽，並取得實際貼文 URL／摘要；既有登入仍可使用。
- 後續實際探索流程可持續導航、搜尋與回查原文，未再出現固定 10 秒的 `Page.navigate` 逾時。

### 2026-10-31 GUI 環境恢復的實測

- 原 profile 的 extension、native host manifest 均通過檢查；running check 原本回報 Chrome 未執行。
- 官方啟動器缺 DISPLAY 時失敗，沿用 user manager 的現有 DISPLAY／XAUTHORITY 後啟動成功。
- browser-client 可以建立分頁、讀取 Threads recent 搜尋、逐批捲動與保存 JSONL，後續可回查原文。
- 本輪最終 32 組皆實際查詢，12 組時間覆蓋完成、20 組依實頁雜訊留下明確不完整原因；搜尋品質限制不等同瀏覽器仍故障。
- 僅驗證本次啟動與工作流，未驗證重新登入／重開機後 agent 自動繼承 GUI env，維持 investigating。

### 2026-10-26 權限恢復的實測

- 同一官方 Chrome 啟動器成功，extension 可導覽 Threads、讀取搜尋結果、捲動並保存 URL／摘要。
- 後續完成 34 組查詢或依實頁雜訊證據略過，取得 1,145 筆原始結果、1,076 個唯一 URL；略過不代表完整歷史時間覆蓋。
- 能回查原文與帳號互動；暫用分頁收尾後關閉，Chrome 保持開啟。
- 這證實本輪工作流恢復，未證實全域預設或所有 browser/profile 分支都已修復，因此本頁維持 `investigating`。

## 下次先查

先檢查啟動器實際選到的 browser/profile 與 GUI env，再檢查 extension/native host。不要直接重裝整套瀏覽器工具。

最短路徑：

1. 確認啟動器用哪個 browser binary 與 profile 路徑。
2. 確認該 profile 有 extension。
3. 確認 native host manifest 存在。
4. 確認 agent process 有 GUI env。
5. 手動開啟同一 profile 後，確認 extension 顯示 Connected。
6. 再重啟 browser helper，讀取一個既有分頁。

若已 Connected 但只能操作空白頁，最短路徑改為：測一般網站導覽 → 比對 App／MCP service／native host 實際版本 → 修正舊版固定設定 → 必要時由 App 重新設定 Computer use → 再測導覽、讀取及實際搜尋。
