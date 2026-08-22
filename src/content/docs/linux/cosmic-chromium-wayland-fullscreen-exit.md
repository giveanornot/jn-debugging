---
title: COSMIC Wayland 下 Chromium 全螢幕立即退出
description: Chromium 系瀏覽器在 COSMIC 原生 Wayland 全螢幕後自動退出時，確認實際後端並以 XWayland flag 維持可用全螢幕。
date: 2026-08-23
tags:
  - linux
  - cosmic
  - wayland
  - chromium
  - brave
  - fullscreen
status: investigating
system: COSMIC / Chromium
severity: medium
aliases:
  - Chromium fullscreen exits COSMIC
  - Brave 全螢幕自動退出
  - ozone-platform x11 fullscreen
  - cosmic-comp 2677
---

## 快速結論

Chromium／Brave 在 COSMIC 原生 Wayland 進入 F11 或影片全螢幕後自動退出時，不應先判定為 extension。`cosmic-comp` 的 [#2683 修正](https://github.com/pop-os/cosmic-comp/pull/2683) 已處理 presentation-feedback 的一種已知原因，但升級到含修正的版本後仍必須重跑 F11 與影片全螢幕；它不是所有 Chromium／COSMIC fullscreen 問題的保證修復。

目前可用的回復方式是將瀏覽器暫時切到 XWayland。設定檔存在不代表已套用：Brave 必須經 distro launcher 啟動，並確認主程序與 GPU process 都帶有 `--ozone-platform=x11`。

## 症狀

- Brave 或 Chromium 進入 F11、YouTube 或其他影片全螢幕後，自行回到視窗模式。
- 無痕模式同樣發生，停用 extension 無法改善。
- 其他瀏覽器設定看起來正常，沒有明確的 browser crash。

## 影響範圍

- COSMIC 桌面環境的原生 Wayland Chromium-family browser。
- 影片全螢幕與一般 F11 全螢幕都可能受影響。
- 不是帳號資料或使用者 profile 損毀；切換 XWayland 的代價是失去原生 Wayland 路徑的部分整合與效能特性。

## 排查

先用無痕模式排除多數 extension 與既有 profile 狀態；若仍重現，改用完全乾淨的 Chromium profile，並明確走 X11：

```bash
task_dir=$(mktemp -d)
chromium --user-data-dir="$task_dir" --ozone-platform=x11 --no-first-run
```

若這個測試可正常維持全螢幕，重點從 extension 轉為原生 Wayland 路徑。再確認既有瀏覽器主程序是否真的帶到預期 flag：

```bash
ps -eo pid,args | rg '/(brave|chromium)( |$)' | rg -v -- '--type='
```

先確認實際的 `cosmic-comp` 版本與 [#2683](https://github.com/pop-os/cosmic-comp/pull/2683) 是否已進入套件。該 PR 修正 compositor 未收取 fullscreen surface presentation feedback、令 Chromium 約 1.5 秒後放棄全螢幕的情況。

即使套件已包含修正，仍要重新測試原始 F11 與影片全螢幕流程。Arch + COSMIC + `brave-bin 1.93.129` 的同類問題已有 [Brave #58101](https://github.com/brave/brave-browser/issues/58101) 回報，且 Brave 以不處理結案；這表示可能還有其他 Wayland fullscreen 路徑。

## 根因

COSMIC compositor 與 Chromium 原生 Wayland fullscreen 流程存在相容性問題，而非 extension。#2683 所修的是 presentation-feedback starvation；若修正已入套件仍重現，不能再將根因精確歸為那一個缺陷，只能確認原生 Wayland 路徑仍不相容。

## 修正

在 Chromium 或 Brave 的啟動 flags 增加：

```text
--ozone-platform=x11
```

Brave 可放入 `~/.config/brave-flags.conf`，保留原有 flags。必須完整結束所有 browser 主程序，再經 distro launcher 重開：

```bash
pkill -TERM -x brave
setsid /usr/bin/brave </dev/null >/dev/null 2>&1 &
```

`/usr/bin/brave` 會讀取 `~/.config/brave-flags.conf` 後再執行實際 binary；直接啟動 `/opt/brave-bin/brave` 會繞過這個 wrapper，使程序仍以原生 Wayland 跑起來。瀏覽器內建 restart 也可能沿用舊的 `--ozone-platform=wayland` 命令列。

想移除 workaround 時，先確認發行版套件含 #2683，再暫時移除單一 flag、完整重開瀏覽器，並實測 F11 與影片全螢幕。任何一項仍會退出，就還原 flag。

## 驗證

- 以乾淨 profile 的 X11 Chromium 進入並維持 F11、影片全螢幕。
- 完整重開 Brave 後，以 `ps` 確認主程序與 GPU process 含有 `--ozone-platform=x11`。
- 若要驗證原生 Wayland，移除 flag、完整重開後確認沒有 Brave XWayland 視窗，再重跑 F11 與影片全螢幕。
- 升級 `cosmic-comp` 後只算前置條件通過；原始全螢幕流程實測成功才可移除 workaround。

## 下次先查

1. 無痕模式是否仍重現。
2. 以乾淨 profile 加 `--ozone-platform=x11` 測試。
3. 確認正在執行的主程序實際 flags，而非只檢查設定檔。
4. 查 `cosmic-comp` 是否已帶入 #2683，然後仍以 F11 與影片全螢幕實測。
5. X11 workaround 未生效時，確認是否透過 `/usr/bin/brave` 而非直接執行 `/opt/brave-bin/brave`。
