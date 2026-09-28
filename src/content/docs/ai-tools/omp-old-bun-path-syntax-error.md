---
title: OMP 新版被舊 Bun 啟動而出現 SyntaxError
description: OMP 已更新卻在 dist/cli.js 報 SyntaxError 時，檢查 shebang 實際解析到的 Bun 與不同啟動環境的 PATH。
date: 2026-09-28
tags:
  - omp
  - bun
  - linux
  - path
status: fixed
system: oh-my-pi
severity: medium
aliases:
  - Oh My Pi Unexpected identifier
  - OMP Bun version mismatch
  - pi-coding-agent cli.js SyntaxError
---

## 快速結論

新版 OMP 已安裝，不代表執行時會使用新版 Bun。`omp` 透過 `#!/usr/bin/env bun` 啟動；如果 login shell、非互動 shell或桌面 launcher 的 `PATH` 先找到舊 Bun，OMP 會在載入自己的 bundled JavaScript 時直接報 `SyntaxError`。

先比較各環境的 `command -v bun` 與 `bun --version`。修正時把相容的 Bun 與 OMP 放到所有啟動環境都會優先搜尋的穩定路徑，GUI launcher 另以明確 `PATH` 啟動。

## 症狀

OMP 更新後，`omp --version` 或任何 `omp config` 命令在真正進入程式前失敗：

```text
SyntaxError: Unexpected identifier 'u'
  at <parse> (.../@oh-my-pi/pi-coding-agent/dist/cli.js:142:1)

Bun v1.3.11
```

同一台機器可能出現不一致結果：互動 terminal 可用，`bash -lc`、systemd user service 或桌面 GUI 卻失敗。

## 影響範圍

- 工具：Oh My Pi（OMP）CLI 與使用它的第三方 GUI
- 環境：同時存在多個 Bun、透過 npm-global 安裝 OMP 的 Linux 桌面
- 影響：OMP CLI、設定查詢、模型呼叫與 GUI child process 無法啟動
- 資料風險：低；主要是 runtime 相容性與 PATH 選擇錯誤

## 排查

先看 shell 實際選到哪些 executable：

```bash
type -a bun
type -a omp
command -v bun
command -v omp
bun --version
omp --version
```

確認 OMP 的 shebang。若是 `/usr/bin/env bun`，它會使用當下 `PATH` 的第一個 `bun`：

```bash
head -n 1 "$(command -v omp)"
```

不要只測目前的互動 shell；至少比較 login/non-interactive shell：

```bash
bash -lc 'printf "%s\n" "$PATH"; command -v bun; bun --version; omp --version'
bash -ic 'command -v bun; bun --version; omp --version'
```

若兩者不同，檢查 `.profile`、`.bashrc`、環境管理器與 user service 的 `Environment=PATH=`。常見陷阱是 `.bashrc` 對非互動 shell 提前 `return`，所以檔案尾端新增的 PATH 只對互動 terminal 生效。

GUI 另有自己的啟動環境。從 launcher log 確認它解析到的 OMP 路徑；不要用 terminal 成功推定 GUI 也會成功。

## 根因

系統同時存在舊 Bun 與新版 Bun，而 OMP executable 使用 `env bun` shebang。不同啟動方式組出的 PATH 順序不同，導致新版 OMP 偶爾被舊 Bun 解析。

錯誤堆疊指向 OMP 的 `dist/cli.js`，容易被誤判為套件檔案損壞；真正證據是錯誤末尾顯示的 Bun 版本，以及 `type -a bun` 找到多個 runtime。

## 修正

先安裝 OMP 支援的 Bun 版本，再讓穩定且普遍存在的 user bin 路徑指向同一組 runtime。以下只示意路徑；目標檔案必須先確認存在：

```bash
mkdir -p "$HOME/.local/bin"
ln -s "$HOME/.npm-global/bin/bun" "$HOME/.local/bin/bun"
ln -s "$HOME/.npm-global/bin/omp" "$HOME/.local/bin/omp"
```

如果路徑已存在，不要直接覆寫；先用 `readlink -f` 判斷是否為自己管理的舊 symlink。

桌面 launcher 或 user service 應明確提供 PATH，避免依賴 `.bashrc`：

```ini
Exec=env PATH=/home/user/.local/bin:/home/user/.npm-global/bin:/usr/local/bin:/usr/bin:/bin /path/to/app.AppImage
```

systemd user service 同理：

```ini
Environment=PATH=/home/user/.local/bin:/home/user/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
```

只調整 `.bashrc` 不足以修好 login、非互動、systemd 與 GUI 四種環境。

## 驗證

確認 login shell 選到相容 runtime：

```bash
bash -lc 'command -v bun; bun --version; command -v omp; omp --version'
```

再驗證 OMP 不只會印版本，也能載入設定與模型清單：

```bash
omp config get defaultThinkingLevel
omp models
```

若有桌面 GUI，從應用程式 launcher 啟動後確認 log 顯示預期的 OMP 路徑；不要只直接執行 AppImage。最後重新登入或重開機再測一次，排除修正只存在於目前 shell。

## 下次先查

看到 OMP 的 `dist/cli.js` 在啟動階段報語法錯誤時，依序檢查：

1. 錯誤末尾的 Bun 版本
2. `type -a bun` 與 `type -a omp`
3. `bash -lc` 和互動 shell 的 PATH 差異
4. GUI／systemd 的明確 PATH
5. OMP 支援的最低 Bun 版本
