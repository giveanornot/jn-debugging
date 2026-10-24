---
title: VSCodium Codex 側欄無法載入：Service Worker InvalidStateError
description: VSCodium 的 openai.chatgpt Webview 無法註冊 Service Worker 時，先正常退出，再備份並重建正確 profile 的快取。
date: 2026-10-24
tags:
  - vscodium
  - vscode
  - codex
  - service-worker
status: fixed
system: codex-ide-extension
severity: medium
aliases:
  - Could not register service worker
  - The document is in an invalid state
  - openai.chatgpt InvalidStateError
---

## 快速結論

遇到以下錯誤時，先確認實際執行的是 VS Code 還是 VSCodium，以及它使用哪個 user-data-dir。儲存工作、完整退出編輯器後，備份並移走該 profile 的 `Service Worker` 目錄，再重新開啟測試。

```text
Error loading webview provided by 'openai.chatgpt':
Could not register service worker: InvalidStateError:
Failed to register a ServiceWorker: The document is in an invalid state.
```

本案例重建 VSCodium 快取後，由使用者確認 Codex 側欄正常顯示；未獨立區分「完整重啟」與「移走快取」各自的效果，不把底層原因直接定成快取損壞。

## 症狀

- 編輯器可以開啟專案，但 Codex 側欄載入失敗。
- 錯誤停在 Webview 的 Service Worker 註冊階段。
- 這段錯誤本身不證明帳號、網路或 Codex app-server 故障。

## 影響範圍

- 環境：Linux／COSMIC Wayland，VSCodium `1.140.06880`、`openai.chatgpt-26.908.40401`。
- 影響：擴充套件的內嵌 Webview。
- 修正範圍：本機編輯器 profile 的 Service Worker 狀態，保留專案、設定與擴充套件。

## 排查

先看實際程序與 profile，不要因錯誤提到 VS Code 就直接清 `~/.config/Code`：

```bash
pgrep -a -x codium
pgrep -a -x code
codium --status
```

程序參數若有 `--user-data-dir`，以那個路徑為準。預設路徑常見為 `~/.config/VSCodium` 或 `~/.config/Code`，但自訂 launcher、portable mode 與其他相容編輯器可能不同。

同時確認有沒有未儲存文件，以及整合終端機中正在執行的服務。本案例有預覽伺服器，因此由使用者存檔並正常關閉編輯器，沒有直接強制結束程序。

## 根因

能確定的是編輯器 Webview 的 Service Worker 初始化失敗。相同錯誤也有 [VS Code 上游追蹤](https://github.com/microsoft/vscode/issues/125993)。

本案例沒有證據把它歸因於 NVIDIA 更新，也不是先前 Remote SSH extension host 仍載入舊版 bundle 的同一個問題；後者另見[舊 extension 排查筆記](/ai-tools/vscodium-remote-ssh-codex-extension-stale-cache/)。

## 修正

儲存工作並完整關閉所有 VSCodium 視窗，確認程序已退出後，在外部終端機操作。以下只適用於已確認的預設 VSCodium profile：

```bash
pgrep -a -x codium
ls -ld "$HOME/.config/VSCodium/Service Worker"
```

`pgrep` 若仍列出程序，先不要搬動快取。確認退出後：

```bash
vscodium_backup="$HOME/.local/state/vscodium-webview-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$vscodium_backup"
cp -p "$HOME/.config/VSCodium/User/globalStorage/state.vscdb" "$vscodium_backup/"
mv "$HOME/.config/VSCodium/Service Worker" "$vscodium_backup/Service Worker"
codium
```

`state.vscdb` 是額外備份，並未刪除或替換；真正重建的是 `Service Worker` 目錄。若該檔在目前 profile 不存在，略過複製即可。

若要回復，先正常關閉編輯器，把新建的 Service Worker 目錄移到另一個備份位置，再把原目錄搬回；不要在程序運行中互換。

## 驗證

- 完整退出後確認已沒有編輯器程序。
- 重新開啟同一個專案與 Codex 側欄，確認原始錯誤消失。
- 本案例由使用者確認側欄正常顯示；未將此擴大宣稱為所有 Codex 收發功能都已測試。
- 若仍失敗，保留當次 Webview console 與 extension output，再查版本或其他初始化錯誤；不要直接刪除整個 profile。

## 下次先查

1. 實際編輯器與 user-data-dir。
2. 儲存工作、正常退出，再試一次。
3. 備份後只重建正確 profile 的 Service Worker。
4. 重測原側欄畫面，仍失敗才沿當次日誌追查。
