---
title: COSMIC Wayland 下 Chromium 全螢幕立即退出
description: Chromium 系瀏覽器在 COSMIC 原生 Wayland 全螢幕約 1.5 秒後退出時，以乾淨 profile 與 XWayland flag 區分 extension、profile 與 compositor 問題。
date: 2026-08-12
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

Chromium／Brave 在 COSMIC 原生 Wayland 進入 F11 或影片全螢幕後約 1.5 秒自動退出，且無痕模式仍會發生時，不應先判定為 extension。以乾淨 profile 加上 `--ozone-platform=x11` 可正常全螢幕，指向 COSMIC compositor 的 Wayland presentation-feedback 相容性問題。

在上游修正進入發行版前，將瀏覽器暫時切到 XWayland；不要在原生 Wayland 與 XWayland 程序混跑後就以為 flag 已生效。

## 症狀

- Brave 或 Chromium 進入 F11、YouTube 或其他影片全螢幕後，約 1.5 秒自行回到視窗模式。
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

可參照上游 [COSMIC issue #2677](https://github.com/pop-os/cosmic-comp/issues/2677)：症狀是 Chrome 接受全螢幕後短暫退出；對應的 [PR #2683](https://github.com/pop-os/cosmic-comp/pull/2683) 說明 compositor 回傳 discarded presentation feedback 會觸發這個退出行為。

## 根因

這是 COSMIC compositor 與新版 Chromium 原生 Wayland 全螢幕流程間的相容性問題，而非 extension。Chromium 在等待 presentation feedback 時收到 compositor 的 discarded feedback，便在約 1.5 秒後取消全螢幕。

## 修正

在 Chromium 或 Brave 的啟動 flags 增加：

```text
--ozone-platform=x11
```

Brave 可放入 `~/.config/brave-flags.conf`，保留原有 flags。必須完整結束所有 browser 主程序再重新啟動；瀏覽器自己的 restart 流程可能沿用舊的 `--ozone-platform=wayland` 命令列，無法套用新設定。

上游修正仍未進入發行版時，保留這個 workaround。待 PR 合併且發行版的 `cosmic-comp` 套件包含修正後，移除上述單一 flag、完整重開瀏覽器並重新測試。

## 驗證

- 以乾淨 profile 的 X11 Chromium 進入並維持 F11、影片全螢幕。
- 完整重開 Brave 後，以 `ps` 確認主程序與 GPU process 含有 `--ozone-platform=x11`。
- 上游修正發布後，移除 workaround，以原生 Wayland 重測兩種全螢幕流程。

## 下次先查

1. 無痕模式是否仍重現。
2. 以乾淨 profile 加 `--ozone-platform=x11` 測試。
3. 確認正在執行的主程序實際 flags，而非只檢查設定檔。
4. 查 COSMIC issue #2677 與發行版 `cosmic-comp` 的版本是否已帶入上游修正。
