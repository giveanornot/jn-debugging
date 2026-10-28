---
title: Remmina VNC 透過 SSH 隧道連線失敗
description: 檢查 Remmina SSH 伺服器、金鑰驗證與遠端 VNC 監聽埠，區分連線建立和桌面畫面驗收。
date: 2026-10-28
tags:
  - remmina
  - ssh
  - vnc
status: investigating
system: remmina
severity: low
aliases:
  - Remmina SSH tunnel authentication failed
  - x11vnc SSH tunnel
---

## 快速結論

SSH 隧道需要指定遠端 SSH 主機與正確的驗證方式；VNC 目的位址則是從遠端 SSH 主機看得到的位址和連接埠。先單獨驗證金鑰登入及遠端 VNC 監聽，再建立 Remmina 設定。

## 症狀與排查

Remmina 連遠端桌面時 SSH 驗證失敗。原設定的 SSH 主機留空、驗證方式為 Kerberos，VNC 埠也與遠端監聽埠不同；截圖中的密碼失敗無法單獨證實其根因。用既有私鑰測試 SSH 登入成功，遠端 `ss -ltn` 顯示 x11vnc 綁定 loopback 的 5909，且可讀到 RFB 協定 banner。

## 修正

在 Remmina 啟用 SSH Tunnel，設定自訂 SSH 主機、帳號及「SSH identity file」，選擇已驗證可登入的私鑰；VNC 目的地設為遠端 loopback 與實際監聽埠。以下為示例，主機及埠應依環境調整：

```ini
server=127.0.0.1:5909
ssh_tunnel_enabled=1
ssh_tunnel_server=example-host:22
ssh_tunnel_username=remote-user
ssh_tunnel_auth=1
ssh_tunnel_privatekey=/path/to/private-key
```

Remmina 的設定值 `1` 對應 SSH identity file；`4` 是 Kerberos。修改現有設定前保留備份；使用者若在圖形介面輸入密碼，應在該介面操作，不必提供給協作者。

## 驗證與限制

修正後，Remmina 程序與遠端 SSH 埠之間出現已建立的連線，遠端 VNC 埠也出現已建立的 loopback 連線。這證明兩段傳輸已建立，**尚未驗證桌面畫面及互動操作**；也未證實原始密碼驗證失敗的單一根因。

## 下次先查

1. 以非互動模式測試既有 SSH 金鑰，再用遠端 `ss -ltn` 確認 VNC 綁定位址和埠。
2. 檢查 Remmina 的 SSH 主機、帳號、驗證方式與私鑰，以及從遠端可到達的 VNC 目的地。
3. 開啟連線後分別確認 SSH、VNC socket 和實際桌面顯示／操作。
