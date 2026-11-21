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
  - /ai-tools/codex-ssh-browser-access-host-unavailable/
category: codex
---

## 快速結論

先比較同一後端內成功與失敗聊天的瀏覽器工具認證欄位是否存在；即使 MCP 顯示 connected，缺少驗證管道仍不能使用瀏覽器。本例有成功的瀏覽器清單對照，但故障聊天尚未修復，也未驗證原本的搜尋流程。

## 症狀

SSH 專案可以執行遠端指令，但 `cua_repl` 列出瀏覽器時回報 `The browser access host is unavailable`。控制端 Desktop 的本機聊天可列出內建瀏覽器和已連接的瀏覽器擴充功能。

## 排查

1. 透過既有的 SSH 路徑確認遠端可達，保留主機金鑰驗證。
2. 比對遠端 SSH proxy、共用 app-server、實際執行瀏覽器工具的子程序，以及 Desktop 直接啟動的 Codex。從正在執行的程序確認執行檔及版本，因為登入 shell 的 `codex --version` 可能指向另一份安裝。
3. 檢查 `BROWSER_USE_ACCESS_EXECUTOR_ID`、`BROWSER_USE_ACCESS_PIPE_PATH` 和 `BROWSER_USE_ACCESS_VERIFYING_IDENTITY` 是否存在且非空。若有 pipe path，在對應主機檢查 Unix socket 是否存在。紀錄欄位狀態即可，驗證值應保留在原程序。

本案例中，遠端 SSH proxy 與共用 app-server 為 0.160.1，缺少三個欄位。該後端啟動的瀏覽器工具收到空的 executor ID，pipe 和 identity 皆缺失。遠端 Desktop 直接啟動的 0.166.0-alpha.6 程序則有三個欄位和 socket。版本與啟動方式同時不同，尚無法分辨哪項造成差異。

後續在同一台機器、同一共用 app-server 下，比對兩個聊天的工具程序：失敗聊天的 executor 為空，pipe 與 identity 缺席；成功聊天三欄皆有值，驗證 socket 存在，且唯讀列出瀏覽器成功。此對照排除了「一定是後端版本不同」作為必要解釋，但單看聊天清單顯示的 SSH 標籤，不能判斷各聊天最初從哪個介面建立。

已安裝 Desktop 的靜態程式碼顯示，產生工具設定時本機 host 分支才取得登入身分並注入驗證資料；這與上述差異吻合。尚未擷取實際 thread/start 或 thread/resume 的完整呼叫，不能確認是哪次註冊造成遺漏。[上游 issue #59925](https://github.com/openai/codex/issues/59925) 另有相似報告，平台不同，不能直接斷定同一根因。

## 修正狀態

尚無經驗證的修復。曾嘗試調整 Desktop 啟動器的本機 daemon 旗標，重開後故障聊天仍缺少驗證資訊；該次調整已撤回。從 Desktop 導覽回原聊天並重設 JavaScript kernel 後，錯誤仍存在。不要複製其他聊天的身分或驗證值，也不要停用驗證。

官方 app-server 原始碼顯示，已載入且仍有訂閱者的聊天重新 resume 時，新的 config overrides 可能被忽略；因此導覽或重設 kernel 不保證重建工具程序。本例未觀察到當次 resume 封包，這是程式碼上的可能解釋，並非該次請求的已證實原因。

## 驗證方式

在同一主機與後端的成功及故障聊天比較唯讀瀏覽器清單與欄位是否存在，不輸出驗證值。本例遠端 Desktop 本機聊天已成功列清單，故障聊天仍失敗；清單成功不代表已驗證讀頁、搜尋及重啟後持久性。

修正候選出現後，在原故障聊天測試列出瀏覽器，並依原工作需求驗證開頁、讀取、搜尋、捲動與關頁；再測 Desktop 重開及接續聊天。各步通過後才能宣稱工作流程及持久性恢復。

此流程保留瀏覽器存取驗證。若目標是從 SSH 聊天使用控制端瀏覽器，先確認產品支援的連線方式。[官方遠端連線說明](https://learn.chatgpt.com/docs/remote-connections#connect-to-an-ssh-host)
