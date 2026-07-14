---
title: Arch NVIDIA 580xx split packages 版本不一致
description: AUR NVIDIA split packages must be upgraded in one transaction, or DKMS and 32-bit userspace versions can block each other.
date: 2026-07-04
tags:
  - arch-linux
  - nvidia
  - aur
  - steam
status: fixed
system: desktop
severity: medium
aliases:
  - nvidia driver library mismatch
  - lib32-nvidia mismatch
  - nvidia-580xx
---

## 快速結論

Arch 上的 NVIDIA 580xx AUR split packages 要整組同版升級。`lib32-nvidia-580xx-utils`、`nvidia-580xx-utils`、`nvidia-580xx-dkms`、`nvidia-580xx-settings` 分批更新時，pacman dependency solver 可能被舊 DKMS 依賴釘住。

用同一個 transaction 安裝整組；若 AUR helper 拆 transaction，就改用 `pacman -U` 同批安裝已 build 的 packages。

## 症狀

- Steam 打不開或 updater 卡住。
- `nvidia-smi` 顯示 driver/library mismatch。
- 32-bit userspace 已升級，但 64-bit userspace / DKMS 還停在舊版。
- AUR helper 升級時卡在依賴：

```text
nvidia-580xx-dkms requires nvidia-580xx-utils=<old-version>
```

## 影響範圍

- 系統：Arch Linux desktop
- 套件：NVIDIA proprietary driver AUR split packages
- 影響：Steam、Wine、Vulkan、32-bit game runtime
- 資料風險：低；但錯誤升級可能造成圖形 session 或遊戲 runtime 不穩

## 排查

檢查目前版本：

```bash
pacman -Q nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings lib32-nvidia-580xx-utils
```

查 AUR package 是否已同版：

```bash
paru -Si nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings lib32-nvidia-580xx-utils
```

如果 `lib32` 已新版、主套件仍舊版，Steam/Wine 最容易先壞，因為 32-bit runtime 會踩到 userspace mismatch。

## 根因

這不是 DKMS 編譯錯，而是 split packages 被 AUR helper 分批 install。舊 `nvidia-580xx-dkms` 仍宣告依賴舊版 `nvidia-580xx-utils`，導致新版 userspace 被 dependency solver 擋住。

NVIDIA 32-bit/64-bit userspace 與 kernel module 版本不一致時，Steam/Wine/Vulkan 會比一般桌面更早暴露問題。

## 修正

先嘗試讓 AUR helper 同 batch 安裝整組：

```bash
paru -S --batchinstall --needed \
  nvidia-580xx-utils \
  nvidia-580xx-dkms \
  nvidia-580xx-settings \
  lib32-nvidia-580xx-utils
```

如果 helper 還是拆 transaction，就用已 build 的 package files 同批安裝：

```bash
sudo pacman -U \
  nvidia-580xx-utils-*.pkg.tar.zst \
  nvidia-580xx-dkms-*.pkg.tar.zst \
  nvidia-580xx-settings-*.pkg.tar.zst \
  lib32-nvidia-580xx-utils-*.pkg.tar.zst
```

升級後重開機，讓 kernel module 與 userspace 對齊。

## 驗證

確認套件同版：

```bash
pacman -Q nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings lib32-nvidia-580xx-utils
```

確認 driver/library match：

```bash
nvidia-smi
dkms status
```

再測 Steam、Wine/Vulkan game 或 `vulkaninfo`。

## 下次先查

Steam 突然打不開、NVIDIA Arch rolling update 後怪異時：

1. `pacman -Q` 比對 32/64-bit NVIDIA packages。
2. 看 `nvidia-smi` 是否 driver/library mismatch。
3. 用單一 transaction 更新 split packages。
4. 重開機後再判斷是否仍是 Steam 本身問題。
