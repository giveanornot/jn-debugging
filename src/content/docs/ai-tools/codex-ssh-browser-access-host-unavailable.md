---
title: Codex SSH 聊天無法連上瀏覽器驗證主機
description: 比較 Desktop 本機聊天與 SSH 共用後端，定位 cua_repl 缺少瀏覽器驗證資訊的環節。
date: 2026-11-16
tags:
  - codex
  - ssh
  - browser
status: investigating
system: Codex Desktop
severity: medium
aliases:
  - The browser access host is unavailable
  - BROWSER_USE_ACCESS_EXECUTOR_ID
---

## 症狀

SSH 專案可以執行遠端指令，但 `cua_repl` 列出瀏覽器時回報 `The browser access host is unavailable`。控制端 Desktop 的本機聊天可列出內建瀏覽器和已連接的瀏覽器擴充功能。

## 排查

1. 透過既有的 SSH 路徑確認遠端可達，保留主機金鑰驗證。
2. 比對遠端 SSH proxy、共用 app-server、實際執行瀏覽器工具的子程序，以及 Desktop 直接啟動的 Codex。從正在執行的程序確認執行檔及版本，因為登入 shell 的 `codex --version` 可能指向另一份安裝。
3. 檢查 `BROWSER_USE_ACCESS_EXECUTOR_ID`、`BROWSER_USE_ACCESS_PIPE_PATH` 和 `BROWSER_USE_ACCESS_VERIFYING_IDENTITY` 是否存在且非空。若有 pipe path，在對應主機檢查 Unix socket 是否存在。紀錄欄位狀態即可，驗證值應保留在原程序。

本案例中，遠端 SSH proxy 與共用 app-server 為 0.160.1，缺少三個欄位。該後端啟動的瀏覽器工具收到空的 executor ID，pipe 和 identity 皆缺失。遠端 Desktop 直接啟動的 0.166.0-alpha.6 程序則有三個欄位和 socket。版本與啟動方式同時不同，尚無法分辨哪項造成差異。

## 驗證方式

在遠端主機的 Desktop 開「此電腦」聊天，並在原 SSH 聊天送出同一個唯讀測試。比較兩邊是否成功列出瀏覽器，失敗時比對原始錯誤。不必開啟或查看分頁。遠端 Desktop 本機測試及 SSH 修復仍待驗證。

此流程保留瀏覽器存取驗證。若目標是從 SSH 聊天使用控制端瀏覽器，先確認產品支援的連線方式。[官方遠端連線說明](https://learn.chatgpt.com/docs/remote-connections#connect-to-an-ssh-host)
