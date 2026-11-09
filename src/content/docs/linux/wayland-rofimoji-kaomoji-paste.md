---
title: COSMIC Wayland 顏文字選取後無法貼上
description: Splatmoji 與 rofimoji 選單正常但無法輸入時，檢查 Wayland 剪貼簿、模擬按鍵和實際貼上結果。
date: 2026-11-10
tags:
  - linux
  - cosmic
  - wayland
  - rofimoji
  - clipboard
status: fixed
system: rofimoji
severity: low
aliases:
  - kaomoji picker paste fails
  - splatmoji wayland paste
---

## 快速結論

COSMIC Wayland 下，舊版 Splatmoji 預設使用 X11 的 `xsel` 與 `xdotool`。選單出現不代表輸入成功。本案例改用 rofimoji 選取，透過 `wl-copy` 和已運行的 `ydotoold` 模擬 Ctrl+V，測試框及使用者的實際操作均回報可用。

## 症狀與排查

- Splatmoji 選單可顯示，選取顏文字後無法正常輸入。檢查桌面快捷鍵，命令為 `splatmoji copypaste`；其設定仍是 X11 預設值。這是相容性風險，並未單獨證實是原始失敗的唯一原因。
- 改測 rofimoji 6.8.0 的 `--action clipboard --clipboarder wl-copy --typer ydotool`，實際 GTK 輸入框沒有收到內容。程式碼顯示它以 Shift+Insert 貼上，隨即恢復剪貼簿；未隔離按鍵相容性或時序，不能斷定具體根因。
- 該版 `ydotool` typer 的 `type_characters` 未實作，不能假設預設 `type` 模式可直接輸入。後續版本應重新檢查。

先確認目前 session、快捷鍵及工具：

```bash
printf '%s\n' "$XDG_SESSION_TYPE" "$XDG_CURRENT_DESKTOP"
command -v rofimoji wl-copy ydotool
systemctl --user status ydotool.service
```

## 修正

保留 rofimoji 選單，以可執行的使用者腳本處理結果，將桌面快捷鍵指向此腳本：

```sh
#!/bin/sh
selection=$(rofimoji --action print --files kaomoji emojis --selector rofi) || exit
[ -n "$selection" ] || exit
printf '%s' "$selection" | wl-copy || exit
sleep 0.3
ydotool key 29:1 47:1 47:0 29:0
```

這會覆寫一般剪貼簿，不會像 rofimoji 的 clipboard 模式嘗試還原。Ctrl+V 適用一般文字框；終端機等應用可能使用其他貼上鍵。`ydotoold` 必須已啟動且使用者可連線。取消選單時不應執行貼上。

## 驗證與下次先查

測試先聚焦 GTK 輸入框，開啟實際選單並選取顏文字；最終腳本貼入完整內容。桌面快捷鍵切換後，使用者回報實際使用看起來正常。未逐一驗證所有應用、終端機或重新登入後的行為。

再發生時先分開確認：選單是否能開、選取結果是否進入剪貼簿、目標應用使用哪個貼上快捷鍵，以及 `ydotoold` 是否能送鍵；不要僅憑程式成功退出判定輸入成功。
