---
title: Arch AUR 更新要求移除 pipewire-jack：lib32-jack2 建置依賴衝突
description: lib32-mpg123 的建置依賴指定 lib32-jack2，間接拉入 jack2；改用通用 lib32-jack provider，保留 PipeWire 並完成建置。
date: 2026-10-07
tags:
  - arch-linux
  - aur
  - paru
  - pipewire
  - jack
status: fixed
system: desktop
severity: low
aliases:
  - jack2 and pipewire-jack are in conflict
  - Remove pipewire-jack
  - lib32-mpg123 makedepends
  - lib32-pipewire-jack
---

## 快速結論

原本使用 PipeWire 的 Arch 系統，若 AUR 更新詢問是否移除 `pipewire-jack`，先選 `N`，再查哪個套件拉入 `jack2`。

本例是 `lib32-mpg123` 1.33.7-1 的建置依賴指定 `lib32-jack2`；後者依賴 `jack2`，造成衝突。安裝 `lib32-pipewire-jack`，將建置依賴改成通用 `lib32-jack` 後，已成功建置安裝，保留 PipeWire 音訊架構。

## 症狀

更新流程下載 PKGBUILD 後，在套件依賴解析階段停住：

```text
resolving dependencies...
looking for conflicting packages...
:: jack2-1.9.22-2 and pipewire-jack-1:1.6.9-1 are in conflict (jack).
Remove pipewire-jack? [y/N]
```

日誌最後顯示 `oh-my-pi-bin` 18.7.0-1，不代表它是衝突來源；本例查到該包只有 `glibc` 必要依賴。

## 影響範圍

- 環境：Arch Linux、Paru、已安裝 `pipewire-jack` 的桌面。
- 套件：本例為 `lib32-mpg123` 的建置依賴及 32 位元 JACK provider。
- 影響：更新交易無法繼續；當時尚未移除音訊套件。
- 修正範圍：本機 AUR PKGBUILD 與 `.SRCINFO`，以及新增 32 位元 PipeWire-JACK 套件。

## 排查

先確認已安裝的 JACK provider：

```bash
pacman -Q pipewire-jack jack2 lib32-pipewire-jack lib32-jack2
```

本例只有 `pipewire-jack` 已安裝，其餘回報 package not found。

搜尋 Paru 現有快取，不只檢查最後一個下載的套件：

```bash
rg -n 'jack' ~/.cache/paru/clone/*/PKGBUILD ~/.cache/paru/clone/*/.SRCINFO
```

找到 `lib32-mpg123` 的指定依賴：

```bash
makedepends=("lib32-sdl2" "lib32-jack2" "lib32-libpulse")
```

再核對套件 metadata：

```bash
pacman -Si lib32-jack2 lib32-pipewire-jack
```

本例 `lib32-jack2` 依賴 `jack2=1.9.22`；`lib32-pipewire-jack` 提供 `lib32-jack` 與 `libjack.so=0-32`，但不提供套件名稱 `lib32-jack2`。

## 根因

依賴鏈為：

```text
lib32-mpg123 的 makedepends
  → lib32-jack2
  → jack2
  → 與已安裝的 pipewire-jack 衝突
```

依賴寫成 `lib32-jack2`，解析器就必須取得該套件；單獨安裝 `lib32-pipewire-jack` 無法滿足這個名稱。改用它提供的通用 `lib32-jack`，才能讓建置使用 PipeWire 的 JACK 相容函式庫。

這項調整在本例以實際建置成功及安裝後函式庫連結驗證；其他套件若使用 JACK server 專用功能，仍要先確認能否採相同修法。

## 修正

在移除 `pipewire-jack` 的提示選 `N`，結束失敗的更新流程。安裝 32 位元 PipeWire-JACK：

```bash
sudo pacman -S --needed lib32-pipewire-jack
```

進入已確認存在的 Paru 快取目錄，備份後修改建置依賴：

```bash
cd ~/.cache/paru/clone/lib32-mpg123
cp PKGBUILD /tmp/lib32-mpg123-PKGBUILD-before-jack-fix
cp .SRCINFO /tmp/lib32-mpg123-SRCINFO-before-jack-fix
sed -i 's/"lib32-jack2"/"lib32-jack"/' PKGBUILD
makepkg --printsrcinfo > .SRCINFO
makepkg -si
```

最小改動：

```diff
-makedepends=("lib32-sdl2" "lib32-jack2" "lib32-libpulse")
+makedepends=("lib32-sdl2" "lib32-jack" "lib32-libpulse")
```

本例原始碼 checksum 與 GPG 簽章檢查通過，成功將 `lib32-mpg123` 從 1.33.5-1 更新到 1.33.7-1。

這是本機修正。後續 helper 更新快取或上游 PKGBUILD 變動時，要重新檢查；不能把這次成功當成上游已修復。

## 驗證

確認套件及通用依賴：

```bash
pacman -Q pipewire-jack lib32-pipewire-jack lib32-mpg123
pacman -T lib32-jack libjack.so=0-32
```

本例版本為 `pipewire-jack` 與 `lib32-pipewire-jack` 1:1.6.9-1、`lib32-mpg123` 1.33.7-1。`pacman -T` 沒有輸出且退出碼為 0，表示依賴滿足。

確認已安裝 JACK 模組的連結及音訊服務：

```bash
ldd /usr/lib32/mpg123/output_jack.so
systemctl --user is-active pipewire pipewire-pulse wireplumber
```

實測 `output_jack.so` 連到 `/usr/lib32/libjack.so.0`，並載入 `libpipewire-0.3.so.0`；沒有缺失的函式庫，三個服務皆為 `active`。這驗證函式庫與服務狀態，未測實際播放或錄音。

最後重跑原始更新流程：

```bash
paru -Syu
```

本例官方更新完成，AUR 依賴與衝突解析通過，列出剩餘套件並到達安裝確認提示。確認後選 `N`，因此只驗證 AUR 更新可以繼續，未完成剩餘整批 AUR 安裝。

## 下次先查

1. 原本使用 PipeWire 時，先保留 `pipewire-jack`，查 `jack2` 是誰拉入。
2. 搜尋 PKGBUILD 與 `.SRCINFO` 的 `jack` 依賴，再用 `pacman -Si` 核對 provider 與依賴鏈。
3. 若是本例的 `lib32-mpg123` 指定依賴，安裝 `lib32-pipewire-jack`，改用 `lib32-jack`，重新建置。
4. 用 `pacman -T`、`ldd` 與音訊服務狀態驗證，再重跑 `paru -Syu`。
