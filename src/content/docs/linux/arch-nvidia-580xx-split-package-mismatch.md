---
title: Arch NVIDIA 580xx split packages 版本不一致
description: AUR NVIDIA 580xx split packages must be upgraded in one transaction, or a sequential Paru install leaves DKMS pinned to the old utils version.
date: 2026-08-25
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

Arch 上的 NVIDIA 580xx AUR split packages 要整組同版升級。`nvidia-580xx-utils`、`nvidia-580xx-dkms`、`nvidia-580xx-settings`、`libxnvctrl-580xx`，以及有安裝時的 `lib32-nvidia-580xx-utils`，不能讓 helper 逐筆安裝。

Paru 要以 `--batchinstall` 先建完所有 AUR packages、再交給 pacman 一次安裝；版本資訊或 build cache 可疑時加 `--rebuild`。若 helper 仍拆 transaction，才改用 `pacman -U` 同批安裝已 build 的 packages。

## 症狀

- Steam 打不開或 updater 卡住。
- `nvidia-smi` 顯示 driver/library mismatch。
- 32-bit userspace 已升級，但 64-bit userspace / DKMS 還停在舊版。
- AUR helper 升級時卡在依賴：

```text
installing nvidia-580xx-utils (580.178.04-1) breaks dependency
'nvidia-580xx-utils=580.173.02' required by nvidia-580xx-dkms
```

## 影響範圍

- 系統：Arch Linux desktop
- 套件：NVIDIA proprietary driver AUR split packages
- 影響：Steam、Wine、Vulkan、32-bit game runtime
- 資料風險：低；但錯誤升級可能造成圖形 session 或遊戲 runtime 不穩

## 排查

檢查目前版本：

```bash
pacman -Q nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings libxnvctrl-580xx
```

查 AUR package 是否已同版：

```bash
paru -Si nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings libxnvctrl-580xx
```

有安裝 32-bit userspace 時也納入比對：

```bash
pacman -Q lib32-nvidia-580xx-utils
```

如果 `lib32` 已新版、主套件仍舊版，Steam/Wine 最容易先壞，因為 32-bit runtime 會踩到 userspace mismatch。

## 根因

這不是 DKMS 編譯錯，而是 split packages 被 AUR helper 分批 install。安裝中的舊 `nvidia-580xx-dkms` 仍嚴格依賴舊版 `nvidia-580xx-utils`，所以一旦 helper 先單獨提交新版 utils，dependency solver 必然拒絕交易。

NVIDIA 32-bit/64-bit userspace 與 kernel module 版本不一致時，Steam/Wine/Vulkan 會比一般桌面更早暴露問題。

## 修正

先讓 Paru 重新建置、並將整組 package 留到同一筆交易：

```bash
paru -S --batchinstall --rebuild \
  nvidia-580xx-utils \
  nvidia-580xx-dkms \
  nvidia-580xx-settings \
  libxnvctrl-580xx
```

如有安裝 32-bit userspace，將 `lib32-nvidia-580xx-utils` 一併加入。完成後再用批次模式跑一般更新，避免其餘 AUR packages 被逐筆安裝：

```bash
paru -Syu --batchinstall
```

如果 helper 還是拆 transaction，就用已 build 的 package files 同批安裝：

```bash
sudo pacman -U \
  nvidia-580xx-utils-*.pkg.tar.zst \
  nvidia-580xx-dkms-*.pkg.tar.zst \
  nvidia-580xx-settings-*.pkg.tar.zst \
  libxnvctrl-580xx-*.pkg.tar.zst \
  lib32-nvidia-580xx-utils-*.pkg.tar.zst
```

升級後重開機，讓 kernel module 與 userspace 對齊。

## 驗證

確認套件同版：

```bash
pacman -Q nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings libxnvctrl-580xx
```

確認 driver/library match：

```bash
nvidia-smi
dkms status
```

再測 Steam、Wine/Vulkan game 或 `vulkaninfo`。

## 下次先查

Steam 突然打不開、NVIDIA Arch rolling update 後怪異時：

1. `pacman -Q` 比對所有已安裝的 NVIDIA split packages。
2. `paru -Si` 確認 AUR 候選版本已一致。
3. 用 `paru -S --batchinstall --rebuild` 單一交易更新 split packages。
4. 重開機後看 `nvidia-smi`、`dkms status`，再判斷是否仍是 Steam 本身問題。
