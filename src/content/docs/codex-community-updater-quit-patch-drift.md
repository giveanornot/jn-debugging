---
title: ChatGPT Community 更新失敗：舊建置器的 Quit 補丁無法套用
description: 修復 codex-update-manager 先遇到磁碟滿、重試後仍卡在 quit-confirmation-focus 的更新流程。
date: 2026-11-22
category: codex
tags: [codex, chatgpt, linux, ubuntu, updater]
status: fixed
system: codex-desktop
severity: medium
aliases:
  - Expected exactly one official Quit coordinator
  - quit-confirmation-focus
  - No space left on device
---

## 快速結論

先看更新器當前候選版本的建置日誌。磁碟空間不足時，清掉可重建的舊建置產物後重試。若重試報必要補丁漂移，改用維護者的新建置工具，維持官方來源驗簽。

## 症狀與根因

首次建置在複製應用程式時回報 `No space left on device`。釋放約 4.5 GB 後重跑，複製成功，舊建置工具卻找不到新版所預期的退出流程，報 `quit-confirmation-focus (failed-required): Expected exactly one official Quit coordinator`。

## 修正

1. 用 `codex-update-manager status` 核對候選版本、錯誤與建置日誌。清理前確認沒有執行中的安裝交易，保留現版的回復套件。
2. 使用維護者的新版原始碼。本次用 commit `2fd3d3d`，重用已下載的 OpenAI stable 套件，執行 `make build-app UPSTREAM_DEB=/path/to/chatgpt.deb`，再建置包含更新器的 `.deb`。
3. 確認建置資訊中的來源版本與 SHA-256，並確認 `signatureVerification` 為 `verified`。關閉桌面應用程式後安裝，再用原本的啟動入口重開。
4. 手動安裝後若更新器仍記住舊版本，先停常駐服務與桌面啟動觸發的 `codex-update-manager-launch-check.service`。沒有進行中的交易時，備份狀態檔，再依已安裝套件的建置資訊對齊來源版本與雜湊，保留已驗證的回復套件。只停常駐服務時，獨立的啟動檢查仍可能蓋回舊狀態。

## 驗證

Ubuntu 上游套件升至 `26.1117.41037`，桌面視窗重開正常。更新服務恢復運作，簽章檢查完成後狀態為 `Idle`，沒有待安裝候選。
