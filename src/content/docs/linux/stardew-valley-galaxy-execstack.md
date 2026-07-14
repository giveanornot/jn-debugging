---
title: Stardew Valley Linux 多人連線卡住
description: Stardew Valley on Linux can hang at Connecting to online services when bundled Galaxy libraries keep an executable GNU_STACK flag.
date: 2026-06-28
tags:
  - linux
  - steam
  - stardew-valley
  - patchelf
status: fixed
system: steam
severity: medium
aliases:
  - Connecting to online services
  - libGalaxy64.so
  - GNU_STACK RWE
---

## 快速結論

Stardew Valley Linux 版多人模式卡在 `Connecting to online services.` 時，檢查 bundled Galaxy libraries 的 `GNU_STACK` flag。

若 `libGalaxy64.so` 或 `libGalaxyCSharpGlue.so` 是 `RWE`，用 `patchelf --clear-execstack` 清掉 executable stack，讓它變成 `RW`。

## 症狀

- Linux / Steam 版 Stardew Valley 可啟動。
- 開多人模式時卡在：

```text
Connecting to online services.
```

- 等很久仍無法進入連線流程。
- 重新開 Steam 或遊戲不一定有效。

## 影響範圍

- 遊戲：Stardew Valley Linux build
- Runtime：Steam Linux
- 影響：多人/online services 初始化失敗
- 資料風險：低；修改遊戲 bundled library metadata，Steam 驗證檔案可能還原

## 排查

先定位遊戲安裝路徑：

```bash
find ~/.local/share/Steam/steamapps/common -maxdepth 2 -type d -iname '*Stardew*'
```

檢查 Galaxy library 的 program headers：

```bash
readelf -l libGalaxy64.so | grep GNU_STACK
readelf -l libGalaxyCSharpGlue.so | grep GNU_STACK
```

如果看到 `RWE`，代表 stack 被標成 executable。

也可用 `execstack` 檢查：

```bash
execstack -q libGalaxy64.so libGalaxyCSharpGlue.so
```

## 根因

bundled Galaxy libraries 帶 executable stack flag，在部分 Linux 環境會讓 online services 初始化卡住。遊戲本身能開，不代表 Galaxy SDK 初始化正常。

Steam 驗證檔案或遊戲更新可能把 library 還原，所以這個修正可能需要重做。

## 修正

安裝 `patchelf` 後清除 execstack：

```bash
patchelf --clear-execstack libGalaxy64.so
patchelf --clear-execstack libGalaxyCSharpGlue.so
```

再次確認：

```bash
readelf -l libGalaxy64.so | grep GNU_STACK
readelf -l libGalaxyCSharpGlue.so | grep GNU_STACK
```

期望從 `RWE` 變成 `RW`。

## 驗證

- 重新啟動 Stardew Valley。
- 進入 multiplayer / online services。
- 不再卡在 `Connecting to online services.`。
- `execstack -q` 顯示目標 libraries 不再是 executable stack。

## 下次先查

Stardew Linux 多人連線又卡住時，先重查兩個 Galaxy libraries 是否被 Steam 更新或驗證還原成 `GNU_STACK RWE`。如果是，重跑 `patchelf --clear-execstack`。
