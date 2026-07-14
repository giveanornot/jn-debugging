---
title: Rime/Fcitx 設定被重設
description: Linux 桌面輸入法設定被切回 keyboard-us 時的排查入口。
date: 2026-06-16
tags:
  - linux
  - rime
  - fcitx
  - input-method
status: fixed
system: desktop
severity: medium
aliases:
  - fcitx reset
  - rime liur profile
---

## 快速結論

先確認 Fcitx profile 是否被切回 `keyboard-us`，再檢查 Rime liur profile 與同步路徑。

不要一開始就重裝 Rime。很多時候 Rime 資料還在，只是 Fcitx profile 沒有啟用對應輸入法。

## 症狀

繁中輸入法不可用，桌面環境看起來仍有輸入法服務，但實際輸入只剩英文鍵盤。

常見表現：

- tray 或設定頁看得到 Fcitx5。
- 切換快捷鍵有反應，但候選窗不出現。
- 應用程式裡只能輸入英文。
- 重新登入後又回到 `keyboard-us`。

## 影響範圍

- Linux 桌面
- Fcitx5
- Rime / 嘸蝦米設定

若只有單一應用程式不能輸入，先排除該 app 的 Wayland/X11/input method integration。若所有應用都失效，再查 Fcitx profile。

## 排查

- 檢查 Fcitx5 addon 與 profile。
- 確認 Rime user data path。
- 確認 Syncthing 或 dotfiles 是否把舊設定覆蓋回來。

先查目前 profile 是否只剩英文鍵盤：

```bash
fcitx5-remote -n
```

再看設定檔是否含目標輸入法：

```bash
sed -n '1,200p' ~/.config/fcitx5/profile
```

接著確認 Rime user data 是否還在：

```bash
find ~/.local/share/fcitx5/rime -maxdepth 2 -type f | sed -n '1,40p'
```

如果資料存在但 profile 沒啟用，優先修 profile；如果資料不存在，才回頭查同步或部署流程。

## 根因

Fcitx profile 被重設成 `keyboard-us`，導致 Rime liur profile 沒有被啟用。

這會讓問題看起來像 Rime 壞掉，但實際上 Rime 沒有進到輸入法列表。重啟 Rime 或重新部署 schema 不會修好 profile 選擇。

## 修正

恢復 Fcitx5 profile，確認 Rime liur schema 可用，並檢查同步設定不再覆蓋 profile。

修正後可以用 GUI 設定工具確認，也可以直接檢查 profile 內容。重點是 profile 裡要有 Rime entry，而不是只有 keyboard layout。

同步工具若會管理 `.config/fcitx5/profile`，要確認同步方向正確；否則每次登入或同步後都可能把修好的 profile 覆蓋回壞版本。

## 驗證

- 重開應用程式後仍可切換輸入法。
- 重登桌面後 profile 沒再被重設。
- Rime 同步路徑存在且內容符合預期。

驗證要包含「重登後」或「重啟 Fcitx 後」：

```bash
fcitx5 -r
fcitx5-remote -n
```

如果只在當前 session 可用，重登後又壞，表示還有同步、桌面 session 或 autostart 層的問題。

## 下次先查

不要先重裝 Rime。先查 Fcitx profile 是否真的載入目標輸入法。

最短路徑：

1. `fcitx5-remote -n`
2. `~/.config/fcitx5/profile`
3. Rime user data path
4. 同步工具是否覆蓋設定
