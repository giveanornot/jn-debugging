---
title: Ubuntu sudo-rs 缺少 setuid 權限而無法提權
description: Ubuntu 的 sudo alternative 指向 sudo-rs 時，若執行檔失去 root setuid 位元，sudo 會直接拒絕執行；可用 Polkit 或 recovery shell 修復。
date: 2026-08-12
tags:
  - ubuntu
  - sudo
  - sudo-rs
  - permissions
  - polkit
status: fixed
system: linux-desktop
severity: high
aliases:
  - sudo must be owned by uid 0 and have the setuid bit set
  - sudo-rs setuid missing
  - Ubuntu sudo 失效
---

## 快速結論

看到下列錯誤時，重開機不會修好：`sudo-rs` 要求實際執行檔由 root 擁有、且具有 setuid 位元。先沿著 `/usr/bin/sudo` 的 alternatives link 找到目標，確認它是受信任的 sudo-rs binary，再把權限修回 `4755`。

若桌面仍有可用的 Polkit authentication agent，可用 `pkexec chmod` 修復，不必進 recovery mode。修完要用 `sudo -n id -u` 驗證；只看檔案 mode 不夠。

## 症狀

一般使用者執行任意 sudo 指令立即失敗，不會進入輸入密碼流程：

```text
sudo-rs: sudo must be owned by uid 0 and have the setuid bit set
```

典型檔案狀態是 alternatives 指到的 sudo-rs executable 為 `0755`，而非 `4755`：

```text
/usr/bin/sudo -> /etc/alternatives/sudo
/etc/alternatives/sudo -> /usr/lib/cargo/bin/sudo
/usr/lib/cargo/bin/sudo  owner=root:root  mode=755 (-rwxr-xr-x)
```

## 影響範圍

- 系統：使用 Ubuntu `sudo-rs`，且 `/usr/bin/sudo` alternative 選到它的系統。
- 影響：使用者無法執行任何需要 root 的維護指令。
- 資料風險：低；這是權限 metadata 問題，不代表 sudoers 或使用者群組遺失。
- 維運風險：高；不要直接假設重開機或重裝桌面會恢復 setuid 權限。

## 排查

先確認錯誤、目前使用者群組，以及 sudo 實際解析到哪個檔案：

```bash
sudo -n true
id
readlink -f /usr/bin/sudo
stat -c '%n owner=%U:%G mode=%a (%A)' "$(readlink -f /usr/bin/sudo)"
update-alternatives --display sudo
```

若目標確實是 distro 安裝的 `sudo-rs` binary，可再用套件資料庫確認歸屬：

```bash
dpkg-query -S "$(readlink -f /usr/bin/sudo)"
dpkg --verify sudo-rs
```

重點是檢查 alternatives 的最終目標，而不是 symlink 本身；symlink 常顯示為 `777`，那不是 setuid 應該設定的位置。

## 根因

`sudo-rs` 以 root-owned setuid executable 取得提權所需的有效 UID。當 alternatives 選中的實際 binary 遺失 setuid 位元，程式會刻意拒絕執行，以免在不安全的權限模型下處理 sudoers。

本案例只證實 executable mode 從預期的 `4755` 漂移為 `0755`；未能從現有套件資料庫與日誌判定是哪一個先前操作改動了它。

## 修正

先確認 target 是預期的受信任 sudo binary，並確認 owner 為 `root:root`。桌面 Polkit 仍可認證時，以 Polkit 執行最小修正：

```bash
target=$(readlink -f /usr/bin/sudo)
stat -c '%n owner=%U:%G mode=%a (%A)' "$target"

# 僅在 target 是已確認的 sudo-rs executable 時執行
pkexec /usr/bin/chmod 4755 "$target"
```

若 Polkit 不可用，從 GRUB 的 recovery mode 進入 root shell，先把 root filesystem 改為可寫，再對同一個已確認的 target 修正：

```bash
mount -o remount,rw /
chmod 4755 /usr/lib/cargo/bin/sudo
```

路徑會依發行版與 alternatives 設定而不同；不要複製 recovery mode 的範例路徑而略過前述解析與 owner 檢查。

## 驗證

```bash
target=$(readlink -f /usr/bin/sudo)
stat -c '%n owner=%U:%G mode=%a (%A)' "$target"
sudo -n id -u
sudo -n -l
```

預期 target 顯示 `root:root` 與 `4755 (-rwsr-xr-x)`，`sudo -n id -u` 輸出 `0`。不需要重開機。

## 下次先查

1. `sudo -n true` 取得精確錯誤。
2. `readlink -f /usr/bin/sudo` 找到實際 executable。
3. 用 `stat` 同時確認 owner 和 mode。
4. 有 Polkit 就以 `pkexec chmod 4755` 修復；否則進 recovery mode。
5. 以 `sudo -n id -u` 做 runtime 驗證，而不是只檢查權限位元。
