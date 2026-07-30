---
title: VSCodium Remote SSH 的 Codex extension 卡在送出中
description: Codex 在 VSCodium Remote SSH 無限轉圈時，檢查遠端 extension host 是否仍載入舊版 extension 與 stale webview cache。
date: 2026-07-31
tags:
  - codex
  - vscodium
  - vscode
  - remote-ssh
status: fixed
system: codex-ide-extension
severity: medium
aliases:
  - Codex extension infinite spinner
  - VSCodium Remote SSH Codex
  - openai.chatgpt stale extension
---

## 快速結論

在 Remote SSH 裡看到 Codex composer 一直轉圈，不一定是網路或登入問題。先看遠端 extension host 實際執行的 `openai.chatgpt-*` 路徑；若它仍啟動已被新版取代的 extension，舊 webview 可能無法處理新的 app-server 回應。

保留目前註冊的新版、隔離舊 extension 目錄，然後用 **Developer: Reload Window** 重新建立 Remote SSH extension host。不要只重啟本機 Codex CLI。

## 症狀

- VSCodium 透過 Remote SSH 開啟專案後，Codex 可以顯示側欄，但送出訊息持續轉圈。
- 遠端的 extension registry 已註冊新版，`~/.vscodium-server/extensions/` 卻還留有舊版資料夾。
- `Codex.log` 指向舊 extension 的 webview bundle，可能出現類似：

```text
[desktop-notifications][unhandled-rejection] TypeError: n is not iterable
.../openai.chatgpt-<old-version>/webview/assets/...
```

有時舊的 app-server 仍能啟動，所以 UI 不會顯示明確的「extension failed」錯誤。

## 影響範圍

- 工具：VSCodium 或 VS Code 相容 editor 的 Remote SSH
- 執行位置：遠端 host 的 extension host
- 使用者影響：Codex 無法送出或取得回覆；一般編輯與 Git 資料不受影響
- 資料風險：低；修正只處理可重新安裝的 extension 與 remote server process

## 排查

先在遠端 host 確認 registry 的目前版本，以及實際 app-server 用的是哪個目錄：

```bash
jq -r '.[] | select(.identifier.id == "openai.chatgpt") | [.version, .location.path] | @tsv' \
  ~/.vscodium-server/extensions/extensions.json

ps -eo pid,ppid,etime,args \
  | grep -E '\.vscodium-server/extensions/openai\.chatgpt' \
  | grep -v grep
```

接著讀本次 Remote SSH session 的 Codex output。日誌目錄依 editor 版本而異，常在下列位置：

```bash
find ~/.local/state/VSCodium -path '*/openai.chatgpt/Codex.log' -type f -print
tail -n 120 ~/.local/state/VSCodium/<session>/exthost*/openai.chatgpt/Codex.log
```

若 registry 指向新版、process 或 stack trace 卻指向舊版，問題是 extension host 沒有隨更新切換。也順便確認遠端的 Codex CLI 可正常執行；這可排除缺 binary 的情況：

```bash
command -v codex
codex --version
```

## 根因

Codex IDE extension 會在遠端 extension host 啟動其 bundled `codex app-server`。extension 更新後，如果現有 Remote SSH window 沒有完整重載，host 和 webview 仍可能維持舊版 bundle；而服務端已回傳新版協定或資料結構時，舊 webview 會在送出時拋出 JavaScript 例外，呈現為無限 spinner。

「extensions.json 顯示最新版」不足以證明目前工作階段真的使用它；process command line 和 `Codex.log` 才是執行中的證據。

## 修正

先不要直接刪除舊目錄，移到遠端的隔離目錄以便還原。以下範例假設 registry 已經指向新版；請先把 `<old-version>` 換成實際值：

```bash
extension_root="$HOME/.vscodium-server/extensions"
old_extension="$extension_root/openai.chatgpt-<old-version>"
quarantine="$HOME/.vscodium-server/extensions-quarantine"

mkdir -p "$quarantine"
mv "$old_extension" "$quarantine/openai.chatgpt-<old-version>.disabled"
```

然後回到該 Remote SSH 視窗：

1. 開啟 Command Palette。
2. 執行 **Developer: Reload Window**。
3. 等待 Remote SSH 重新連線，再開啟 Codex sidebar。
4. 送一則短訊息驗證。

若 host 沒有自行重建，可先中斷並重新連線 Remote SSH。避免對整個 `~/.vscodium-server` 做遞迴刪除；那會移除所有遠端 editor state，且通常不是必要修正。

## 驗證

重連後，確認新的 process 路徑已和 registry 相同：

```bash
ps -eo pid,args \
  | grep -E '\.vscodium-server/extensions/openai\.chatgpt' \
  | grep -v grep
```

- path 指向 registry 的新版 extension。
- `Codex.log` 不再引用舊版 webview assets，也不再出現送出時的 `TypeError`。
- 在 sidebar 建立新 chat 並送出簡短訊息，可正常收到回覆。

## 下次先查

1. 看 `extensions.json` 的已註冊版本。
2. 看遠端 `codex app-server` 的實際路徑。
3. 看 `Codex.log` 是否指向另一個舊版資料夾。
4. 隔離已淘汰的 extension，然後 **Developer: Reload Window**。
