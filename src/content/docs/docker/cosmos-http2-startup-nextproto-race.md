---
title: Cosmos HTTP1 正常、HTTP2 連線關閉：共用 Server 啟動競態
description: Cosmos 的 plain HTTP 與 TLS handoff 共用 Go HTTP Server，初始化次序可能讓 h2 協商成功卻沒有 HTTP2 handler。
date: 2026-11-21
tags:
  - cosmos
  - golang
  - http2
  - startup-race
status: fixed
system: cosmos-server
severity: high
aliases:
  - ERR_CONNECTION_CLOSED Cosmos
  - curl 16 HTTP2 framing layer
  - nextProtoOnce ServeTLS Serve
---

## 快速結論

這次 Cosmos v0.24.0 的公開服務在 HTTP/1.1 正常，HTTP/2 卻關閉連線。修法是在啟動任何 listener goroutine 前，於共用 Server 的 TLSConfig 明確設定 `NextProtos: []string{"h2", "http/1.1"}`，保留原本的 GetCertificate。

這是自行驗證並部署的本地修正版，不能據此宣稱上游已發布修補。重啟可改變啟動次序，屬復原措施；停用 HTTP/2 會掩蓋問題。

## 症狀

- 瀏覽器回報 `ERR_CONNECTION_CLOSED`。
- 相同網域與路徑，HTTP/1.1 回200，HTTP/2 協商後失敗，可能出現 curl exit16。
- 容器仍運行、應用健康檢查正常，多個共用入口的服務卻一起受影響。

先在相同來源測試兩種協定，保留憑證驗證：

```bash
curl --http1.1 -sS -o /dev/null -w '%{http_version}|%{http_code}\n' https://service.example.com/
curl --http2 -sS -o /dev/null -w '%{http_version}|%{http_code}\n' https://service.example.com/
```

HTTP2驗收必須看見 `2|200`，不能只看 curl exit0，因為協商可能回退HTTP1。

## 影響範圍

本案為同一個 Cosmos HTTP Server 同時處理公開TLS、handoff TLS與plain HTTP的路徑。測試基準是v0.24.0 commit `fa0a6523888d05c2b62540777aa29b0e875f1940`；原binary為Go1.27.3，修正版用Go1.27.4。不是所有HTTP2連線關閉都由此競態造成。

## 排查

1. 比對同一入口的H1/H2，避免把後端正常或容器healthy當成公開入口正常。
2. 讀實際binary buildinfo與精確版本程式碼，確認共用Server與TLSConfig的建立、handoff和公開listener次序。
3. 用三個listener共用同一Server重現；讓plain Serve確實進入Accept，再啟動兩條TLS路徑。
4. 在實際TLSConfig建構函式上建立回歸；先證明原設定失敗，再套修正。

## 根因

Go的Serve與ServeTLS共用一次性的HTTP2初始化。當TLSConfig存在卻未列出h2，plain Serve先取得初始化機會時可能不安裝HTTP2 handler；後續TLS宣告h2，卻沒有相應處理器。這個判讀結合了受控重現與[Go該版本的HTTP Server程式碼](https://github.com/golang/go/blob/go1.27.3/src/net/http/server.go)。

重啟改變排程，解釋了為什麼「再重啟一次就好」；它不能證明缺陷已消失。

## 修正

在listener啟動前建立設定，不能等Serve已經開始才改共享TLSConfig：

```go
func serverTLSConfig(getCert func(*tls.ClientHelloInfo) (*tls.Certificate, error)) *tls.Config {
    return &tls.Config{
        GetCertificate: getCert,
        NextProtos: []string{"h2", "http/1.1"},
    }
}
```

本案保留既有依賴鎖定，完整編譯後以原映像的immutable digest為基底，只替換binary。測試app使用自己的設定、SQLite、憑證及空Docker API fixture，不掛正式Docker socket或帳號資料。

部署前另有一個陷阱：Cosmos自動接上的網路比Compose宣告多。必須以active inspect保留Config、HostConfig與全部網路，不能直接用只有default network的Compose重建。本案先在lab演練clone及rollback；正式先建立未啟動candidate，減少停機後才發現API輸入錯誤。

## 驗證

- 強制plain-first原版H2為0/20；隨機啟動原版74/100；修正版200/200，H1同時全過。
- 實際建構函式回歸在Go1.27.3與1.27.4各100次通過；完整proxy tests與binary build通過。
- 完整app的小型lab中，原版20次及修正版30次冷啟動都通過。原版自然啟動未失敗，不取代強制次序測試的因果證據。
- 正式保留全部36個網路、設定與憑證SHA、auth表筆數；16個啟用網域路由前後一致，另驗12個公開入口H2正常。
- 管理API的允許來源未登入回401，未列入白名單的bridge來源回403；不可把網路timeout當權限測試通過。

## 下次先查

先測同一路徑H1/H2並核對實際協定；若只有H2壞，再查共用Server的初始化。未合併上游前，升級映像須確認修正仍在。保留有限次數的復原檢查、原映像與SQLite線上備份；回復程式時不要拿舊資料庫覆蓋切換後寫入。清掉繼承正式Compose labels的停止備援容器，避免未來選取服務時混入副本。
