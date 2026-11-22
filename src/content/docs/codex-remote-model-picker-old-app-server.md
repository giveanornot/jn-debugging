---
title: Codex 遠端模型選單少了新模型：共用 app-server 仍在跑舊版
description: 核對 SSH 遠端模型選單、CLI 與執行中的 app-server 版本，並驗證模型實際可用。
date: 2026-11-22
category: codex
tags: [codex, linux, remote, ssh, app-server]
status: fixed
system: codex
severity: medium
aliases:
  - GPT-6.2 Sol missing
  - model/list
  - app server is running but is not managed by codex app-server daemon
---

## 快速結論

遠端工作區的模型選單缺少新模型時，先查遠端連線實際使用的 app-server。桌面版內附 CLI、新啟動的命令列 CLI，以及常駐 app-server 可以同時是三個版本。

## 排查

```sh
codex --version
codex app-server daemon version
```

比對 `cliVersion` 與 `appServerVersion`。再透過同一個遠端端點呼叫 `model/list`。本例桌面版內附 CLI 已能列出 GPT-6.2 Sol 與 Astra，共用端點直到後端升級前仍只列出舊模型。SSH 的 `codex app-server proxy` 轉送的是原始 WebSocket 連線，探測時先完成 HTTP Upgrade，再送 WebSocket JSON-RPC 訊息。

## 修正

1. 依既有安裝方式升級遠端 CLI。本例使用 npm 安裝穩定版 `@openai/codex@0.171.0`，接著查實際後端版本。
2. 優先用原生 `codex app-server daemon restart`。若回報正在執行但未受管理，先查目前是否有工作執行，並確認真正持有監聽 socket 的舊 app-server 行程。正常終止該行程後，再用新版 CLI 執行原有啟動設定。本例使用 `codex app-server daemon bootstrap --remote-control`，保留原本的 Remote 用法。
3. 重新連線後，以遠端端點查 `model/list`。若帳號有權使用該模型，可用暫時聊天跑一個簡單回合驗收。

## 驗證

CLI、受管理套件與 app-server 都回報 `0.171.0`。SSH 代理列出 GPT-6.2 Sol 與 Astra，已登入帳號的 Sol 測試回合完成。若控制端選單仍留著舊清單，先重新連線遠端工作區。
