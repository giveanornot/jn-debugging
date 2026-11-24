---
title: Arch Linux 的 Web Serial 選得到裝置，開啟 ttyACM 卻失敗
description: 用裝置節點的權限和占用狀態定位 Web Serial 連線問題，並確認瀏覽器終端能送出指令。
date: 2026-11-24
category: permissions
tags:
  - arch-linux
  - web-serial
  - chromium
  - usb
status: fixed
system: Web Serial
severity: low
aliases:
  - Failed to open serial port
  - ttyACM0 uucp
  - Serial Terminal Local echo
---

## 快速結論

瀏覽器的裝置選擇器能列出 Arduino，但開啟時失敗，先查 Linux 裝置節點的讀寫權限和占用者。USB 重新辨識會建立新的裝置節點，先前在舊節點加的 ACL 要重設。

## 症狀

Arch Linux 上的 Brave 開啟 Web Serial 終端時可以選到 Mega 2560，隨後出現錯誤。

~~~text
Failed to execute 'open' on 'SerialPort': Failed to open serial port.
<DISCONNECTED>
~~~

## 排查

`/dev/serial/by-id/` 確認裝置實際對應到哪個節點。將下列 `ttyACM0` 換成當下看到的名稱。

~~~bash
ls -l /dev/serial/by-id/
getfacl -p /dev/ttyACM0
fuser -v /dev/ttyACM0
id
~~~

本例的節點屬於 `root:uucp`，操作帳號沒有 `uucp` 群組或個別 ACL。當下也沒有其他程序占用序列埠。連線成功後，`fuser` 可以看到 Brave 占用裝置。要切換成其他串列工具時，先在網頁按 **Disconnect**。

## 修正

在執行瀏覽器的桌面帳號下，從系統終端暫時授權這個裝置。將 `LOGIN_NAME` 換成 `id -un` 回傳的實際名稱。

~~~bash
sudo setfacl -m u:LOGIN_NAME:rw /dev/ttyACM0
getfacl -p /dev/ttyACM0
~~~

保持 USB 接著，再從瀏覽器連線。若終端能收到開機訊息，點進輸出區即可輸入。Google ChromeLabs Serial Terminal 可勾 **Local echo** 顯示按鍵。本案例的 Marlin 用自訂鮑率 `250000`，連上後用 `M115` 驗證收發。[ChromeLabs Serial Terminal](https://googlechromelabs.github.io/serial-terminal/)

## 驗證

- 重加 ACL 後，瀏覽器收到 `External Reset` 和 Marlin 開機訊息，之後同一頁成功下達 G-code 並收到回應。
- USB 再辨識後，原裝置 ACL 消失，瀏覽器再次出現同一錯誤。重加 ACL 後恢復。本例採用單次連線授權，長期權限設定未變更。

## 下次先查

先看節點是否重建、ACL 是否仍在，接著看是否有瀏覽器或其他終端占用。若已收到控制器開機訊息，直接驗證終端焦點、Local echo 與一條唯讀查詢。
