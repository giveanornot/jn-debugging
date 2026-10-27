---
title: Wrangler 遠端登入改用裝置授權，避免 localhost 回呼失敗
description: 在 SSH、Remote 或 container 執行 Wrangler 時，使用 device flow 由另一台裝置完成授權，不依賴遠端桌面或 localhost callback。
date: 2026-10-27
tags:
  - cloudflare
  - wrangler
  - oauth
  - remote
status: fixed
system: wrangler
severity: medium
aliases:
  - Wrangler auth token expired remote
  - localhost 8976 callback
  - wrangler login device
---

## 快速結論

Wrangler 在遠端機器執行時，使用者瀏覽器的 `localhost:8976` 指向使用者裝置，不能直接回到遠端程序。Wrangler 4.119.0 起提供 device flow；本案以 4.153.0 實測完成授權及 Pages 部署。[官方發布說明](https://developers.cloudflare.com/changelog/post/2026-08-04-wrangler-login-device-flow/)

## 症狀

- 原部署登入已過期，無法 refresh。
- 一般 `wrangler login` 顯示已開啟網址，使用者卻沒有看見頁面。
- 授權最終等待 callback 逾時。

## 影響範圍

遠端 SSH、container、Codespaces 及同類操作。遠端 shell 的 `xdg-open` 成功，只能表示遠端接受開啟要求，不能證明使用者看得到；聊天工具回 queued 或 browser visibility 為 false，也不能當成已顯示視窗。

## 排查

先分清「Wrangler 所在機器」和「使用者瀏覽器所在機器」，再檢查 CLI 版本與 `login --help`。本案舊版 4.112.0 沒有 device 參數，重複開一般 OAuth 網址無法解決 remote callback 問題。

## 根因

一般 OAuth flow 依賴本機 callback listener，但遠端程序和使用者瀏覽器不共用 loopback。遠端啟動瀏覽器也不等於在使用者目前裝置開啟視窗。

## 修正

本案保留專案既有 dependency，只暫時執行已查核、支援 device flow 的版本：

```bash
npx --yes wrangler@4.153.0 login --device --browser=false
```

CLI 會輸出 verification URL 與短效 user code。由使用者在手上裝置開啟該 URL、輸入本次代碼並審閱授權；遠端 Wrangler 輪詢取得結果，不啟動 localhost callback。

代碼過期就重新啟動流程，不能重用舊 code 或 OAuth state。不要將實際代碼、token 或帳號資訊寫入 runbook。需要的權限應維持既有授權範圍。

## 驗證

遠端 CLI 回報 `Successfully logged in`，之後使用既有專案 Wrangler 執行 Pages 部署成功；正式站 HTML、headers 與乾淨 browser 驗證均通過。不是只憑使用者說已按授權，就假設 token 已取得。

## 下次先查

確認 remote 與 CLI 版本後，優先用 device flow；沒有支援時再依官方說明規劃回呼轉送，避免先給無法使用的 localhost 連結。
