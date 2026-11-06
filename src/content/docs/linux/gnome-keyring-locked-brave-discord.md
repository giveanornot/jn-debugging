---
title: 指紋登入後 Brave 空白與 Discord 啟動卡住
description: Brave 頁面持續空白、Discord 卡在啟動時，檢查 GNOME Login Keyring 是否鎖定及解鎖提示是否被遮住。
date: 2026-11-06
tags:
  - linux
  - brave
  - discord
  - gnome-keyring
  - fingerprint
  - cosmic
status: fixed
system: GNOME Keyring / Brave / Discord
severity: medium
aliases:
  - Brave blank pages locked keyring
  - Discord loading fingerprint login keyring
  - Unlock Login Keyring 視窗被遮住
---

## 快速結論

登入金鑰圈仍上鎖時，Brave 網頁可能持續空白，Discord 可能卡在啟動。確認 Login Keyring 的 `Locked` 狀態，找到可能被其他視窗遮住的「Unlock Login Keyring」提示，讓使用者輸入金鑰圈密碼。不要要求使用者在聊天中提供密碼。

## 症狀與範圍

一次 Arch Linux／COSMIC 個案中，Brave 多個網站空白、Discord 卡住；其他桌面程式正常。獨立 Brave 設定檔與 X11／Wayland 對照仍重現。這些症狀也可能有其他原因，不能單憑空白判斷金鑰圈故障。

## 排查

檢查目前 session 的金鑰圈鎖定狀態，不讀取任何儲存的密碼：

```bash
busctl --user get-property org.freedesktop.secrets \
  /org/freedesktop/secrets/collection/login \
  org.freedesktop.Secret.Collection Locked
```

`b true` 表示上鎖。檢查登入管理員紀錄中的 `gkr-pam: couldn't unlock the login keyring`，並尋找桌面其他視窗或工作區中的解鎖提示。不同登入管理員使用的 PAM service 可能不同。

本次以隔離 Brave profile 測試：預設密碼儲存時網頁請求持續等待，另一個隔離測試使用 `--password-store=basic` 能載入。這是診斷對照，**不要直接套到日常 profile**；它會改變密碼儲存方式。系統 `curl` 成功只證明系統連線，不等於瀏覽器已載入。

## 根因與修正

該次指紋登入後，Login Keyring 保持上鎖；解鎖提示位於另一視窗後方。指紋驗證不會提供金鑰圈解密所需的密碼。使用者找到提示並解鎖後恢復；沒有修改 PAM、密碼或瀏覽器設定。

若使用密碼登入，且登入密碼與金鑰圈密碼相同、PAM 整合正常，金鑰圈通常能一併解鎖；本次沒有實測該登入路徑。指紋登入的其他自動解鎖方案另需評估。不要將金鑰圈密碼清空作為無代價修法：空密碼會使金鑰圈內容不再加密。[ArchWiki 說明](https://wiki.archlinux.org/title/GNOME/Keyring#Unlocking_with_fingerprint_login)

## 驗證與下次先查

解鎖後，`Locked` 由 `true` 變為 `false`，先前等待的兩個隔離 Brave 網頁請求完成，Discord 日誌進入主程式；使用者確認原本兩個視窗恢復。這證明本次解鎖與恢復的關係，不證明所有同類問題都由金鑰圈造成。

下次先檢查鎖定狀態及被遮住的提示，解鎖後重測原始視窗。若仍無法載入，再分別追查網路、圖形與各程式日誌。
