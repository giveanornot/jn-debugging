---
title: Codex 社群版建置失敗：舊套件與最新 signed stable 不一致
description: Distinguish a pinned old Codex Linux package from a corrupt download when the community installer verifies only the latest signed stable release.
date: 2026-11-06
tags:
  - codex
  - arch-linux
  - aur
  - package-verification
status: wontfix
system: desktop
severity: low
aliases:
  - Local package does not match the current signed stable release
  - codex-desktop-linux size mismatch
---

## 快速結論

`codex-desktop-linux` 建置時出現 `Local package does not match the current signed stable release`，先比對版本。若 PKGBUILD 鎖定舊 `.deb`，安裝器卻只驗證目前 stable，即使下載完整也會被拒絕。

本例確認是版本鎖定與驗證政策衝突，沒有停用驗簽。依使用者決定移除社群版，保留已安裝的官方 `chatgpt-bin`；社群版打包流程本身尚未修復，因此標記 `wontfix`。

## 症狀

```text
Using explicitly provided upstream Linux package: chatgpt_26.1027.30824_amd64.deb
Local package does not match the current signed stable release (26.1103.31037, amd64).
Cause: chatgpt_26.1027.30824_amd64.deb size mismatch: expected 562447122, got 534538410
Official Linux package candidate failed; existing installation was not changed
```

錯誤中的預期大小來自較新版本；單憑 `size mismatch` 不能判定舊檔下載不完整。

## 影響範圍

Arch Linux、paru，以及使用 rolling Git 來源但鎖定官方 `.deb` 版本的社群版 PKGBUILD。失敗發生在候選建置階段，沒有替換既有安裝。

套件版本是本次觀察值，不代表未來 stable 版本。官方版與社群版是不同套件，須先核對本機實際安裝與執行路徑。

## 排查

檢查已安裝套件及執行中的主程式：

```bash
pacman -Q codex-desktop-linux chatgpt-bin
pgrep -af '^/usr/lib/chatgpt/ChatGPT( |$)'
```

從 paru 實際建置目錄讀取 PKGBUILD 的 `_appver`、`source`、`sha256sums`，再比對 Git 來源的 `nix/upstream-linux-packages.json` 與 `build()` 呼叫的 `install.sh`。不要為了讓建置過關而只改其中一個版本號。

```bash
sha256sum /path/to/chatgpt_26.1027.30824_amd64.deb
```

本例舊檔的 SHA-256 與 PKGBUILD、Nix pin 完全相同：

```text
4e139a44f7c917a643f2dd014ad32298dd30aec6d324d323524b190f7667684c
```

再檢查該來源版本的 `scripts/lib/upstream-linux-package.js` 與 `.sh`：即使明確提供本機套件，預設仍查目前 signed stable。該版本的 verifier 支援 `--metadata-only`；以其內建 repository key 與原有參數執行後，取得 `26.1103.31037`、大小 `562447122`，且 `signatureVerification` 為 `verified`。

## 根因

PKGBUILD 與 Nix pin 選定 `26.1027.30824`，但安裝器要求本機套件與目前 signed stable `26.1103.31037` 一致。兩個版本的大小與雜湊自然不同。

這不是缺少系統依賴，也不是重新下載同一個舊檔就能修好的快取問題。舊檔雜湊符合 PKGBUILD，只能證明符合打包者的 pin，不能代替官方 signed metadata 驗證。

## 修正

本輪選擇停止使用社群版。先確認官方版確實存在、正在使用，社群版無相依套件且沒有執行中的程序，再移除：

```bash
sudo pacman -R codex-desktop-linux
```

不使用遞迴移除依賴選項，也不刪使用者 profile、登入狀態或 `~/.codex`。若需要保留社群功能，則必須另外更新並驗證打包版本與 patch 相容性；本例沒有完成這條修復路徑。

錯誤提供的 `--skip-oai-official-sig-verification` 會跳過官方驗證，本輪未採用。不要把它當成自動修復或靜默 fallback。

## 驗證

- 移除前：官方 `chatgpt-bin 26.1103.31037-1` 已安裝，主程序位於 `/usr/lib/chatgpt/ChatGPT`。
- 移除後：`pacman -Q codex-desktop-linux` 顯示找不到套件；社群版 launcher 與 desktop entry 已移除。
- 官方套件與原本程序仍存在，使用者資料未移除；沒有另外重啟 GUI 或重新驗收全部功能。
- 未重新建置社群版，不宣稱原本 PKGBUILD 已修復。

## 下次先查

先比較 PKGBUILD pin、本機 `.deb` 版本與 signed stable 版本。三者不一致時，查驗證政策與打包者更新，不先清快取或繞過簽章。
