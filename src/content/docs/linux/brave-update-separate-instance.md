---
title: Brave 更新後外部連結開成另一個瀏覽器實例
description: Brave 長時間未重啟時，套件更新後由系統 URL handler 開啟的連結可能啟動新版程序，而非交給舊版視窗。
date: 2026-08-04
tags:
  - brave
  - browser
  - linux-desktop
  - package-update
status: fixed
system: linux-desktop
severity: low
aliases:
  - Brave 外部連結另開視窗
  - Brave 不是同一個實例
  - Brave update separate process
  - xdg-open Brave
---

## 快速結論

若 Brave 在系統套件更新前已持續開啟很久，外部應用程式透過 `xdg-open` 開網址時，會執行磁碟上的新版 `brave`。若它沒有把請求交給仍在執行的舊版程序，就會出現第二個 Brave 主程序，視窗、登入狀態或擴充功能看起來像不是同一個瀏覽器。

先確認 URL handler 仍指向 Brave，再比對兩個主程序的啟動時間與版本。存好未同步的分頁後，完全結束 Brave 再重新開啟，讓所有視窗都回到同一版本的程序。

## 症狀

- 從桌面 app、聊天 app 或檔案管理員點網址時，Brave 另開一組看起來陌生的視窗。
- 新視窗的登入狀態、分頁群組或擴充功能和原本正在使用的視窗不一致。
- 使用者懷疑系統把連結開到 Chrome、另一個 Brave profile，或另一個安裝來源。

## 影響範圍

- Linux 桌面環境使用 `xdg-open` 的外部網址。
- 長時間不重啟、且在期間更新過 Brave 的工作階段。
- 使用者可能在錯的視窗操作登入服務，或誤以為資料與設定遺失。

不會自動刪除 profile 資料；風險主要是未同步分頁或表單資料在關閉舊程序時遺失。

## 排查

先確認系統 HTTP(S) handler 指向哪個桌面啟動器：

```bash
xdg-mime query default x-scheme-handler/https
xdg-mime query default text/html
```

接著讀取啟動器的實際命令。一般 Brave 安裝會是 `brave %U`，代表外部連結由目前安裝在磁碟上的 Brave binary 處理：

```bash
rg '^(Name|Exec|TryExec)=' /usr/share/applications/brave-browser.desktop
```

不要只看 renderer 或 GPU process；只比對沒有 `--type=` 的 Brave 主程序，以及它們的啟動時間：

```bash
ps -eo pid,ppid,lstart,args \
  | rg '/brave( |$)' \
  | rg -v -- ' --type='
```

在 Arch Linux，可再確認目前套件版本：

```bash
pacman -Q brave-bin
```

若一個主程序早於套件更新而啟動，另一個剛好由 `xdg-open <URL>` 觸發，且兩者版本不同，就不是預設 handler 選到別的瀏覽器。這是外部連結啟動新版 binary，但既有舊版程序沒有接收該連結的情況。

## 根因

系統 URL handler 與原先使用的 browser 可同時都叫 Brave，但負責處理新連結的是執行 `brave %U` 的當前安裝檔。套件升級會替換該檔案，不會替換記憶體裡已執行的舊版 browser。

因此「外部連結另開一個 Brave」不必然表示選錯 profile 或誤裝 Chrome；先排除不同版本的主程序並存，才能判斷是否真的有 profile 設定問題。

## 修正

1. 在兩組視窗都確認重要分頁已同步、下載完成，且表單內容已儲存。
2. 用 Brave 的 **Exit / 結束** 完整退出所有視窗；若啟用背景 app，也一併退出背景程序。
3. 從應用程式啟動器重新開 Brave，再測一次外部連結。

這不需要改預設瀏覽器設定。只有重新開啟後仍然分裂成不同 profile，才繼續檢查 desktop entry 是否帶了 `--user-data-dir` 或 `--profile-directory`。

## 驗證

- `ps` 只顯示一個沒有 `--type=` 的 Brave 主程序。
- 該程序版本與已安裝套件相同。
- 從外部應用程式點開 HTTPS 網址後，連結進入原本使用中的 Brave 視窗或分頁。
- 不再出現需要重新登入、找不到原本擴充功能的第二組視窗。

## 下次先查

1. `xdg-mime query default x-scheme-handler/https`
2. 主程序的啟動時間與版本是否相差一個套件更新週期。
3. 確認後再完整重啟 Brave；不要先改預設瀏覽器或重設 profile。
