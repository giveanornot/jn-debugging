---
title: Wine 下 KartRider 進入賽事時 NMService.exe 崩潰
description: KartRider 可進大廳但一進實際賽事即崩潰時，辨識舊 beanfun NMService.exe access violation，並安全回退 Wine 測試的方法。
date: 2026-07-24
tags:
  - wine
  - gaming
  - compatibility
  - beanfun
status: investigating
system: Wine / KartRider / beanfun
severity: medium
aliases:
  - KartRider Wine race crash
  - NMService.exe access violation
  - beanfun Wine crash
---

## 快速結論

若 KartRider 在 Wine 中能登入、進大廳，卻在載入實際賽事時立即退出，先檢查 crash dump 是否指向 `NMService.exe`。本例的 dump 是 `0xc0000005` read access violation；不是 DXVK、VSync 或輸入延遲造成。

所有相容性嘗試都應在複製的 Wine prefix 進行。未能讓「實際賽事」成功前，不要覆蓋原本可登入或可進大廳的基準 prefix。

## 症狀

- Launcher 顯示登入、連線與 patch 成功。
- 遊戲可進大廳，但按下開始、進入實際賽事的載入階段後崩潰。
- Launcher 視窗可能停在 `Login...Ok`，但那不是已進入遊戲本體的證據。

Dump 的關鍵例外：

```text
Exception: 0xc0000005
Faulting module: NMService.exe
Access: read
Address: 0x00d40000
```

## 影響範圍

- 系統：Linux desktop，以 Wine 執行舊版 Windows 線上遊戲。
- 使用者可見影響：可登入與大廳，但不能進入實際賽事。
- 資料風險：主要是將可用 Wine prefix 覆寫成不可登入的設定；不應直接替換原始遊戲服務程式。

## 排查

先保留基準，將 prefix 複製後才進行實驗：

```bash
cp -a /path/to/game/.wine-prefix /path/to/game/.wine-prefix-test
```

在原始 prefix 的遊戲資料目錄尋找最近的 dump，再讀取例外資訊：

```bash
find /path/to/prefix/drive_c -type f -name '*.dmp' -printf '%T@ %p\n' | sort -n
winedump dump -j exception /path/to/latest.dmp
```

若 dump 指向 `NMService.exe`，記下模組位址與 exception address；可用反組譯確認是否落在 memcpy 類的記憶體讀取，但不要把這當成已能修補程式的證據。

此案例依序在隔離 prefix 測試過：

- DXVK 與不同 Direct3D 路徑。
- Proton GE／Experimental runtime。
- Windows 版本與 DLL 覆寫。
- WinINet、RPC service 啟動與極小服務 stub。

它們都沒有讓實際賽事完成載入；有些還讓 Launcher 更早退出。因此應回復基準，不要累加設定。

## 根因

已能確定的最小根因是：舊 beanfun `NMService.exe` 在賽事流程中於 Wine 觸發非法記憶體讀取。例外位址落在其內部 memcpy 類路徑，目標位址無效。

這排除了「只調低 input latency」或「改 VSync」能修正賽事 crash 的假設。但尚未能從 dump 單獨判定，是 Wine API 相容性、服務通訊協定或該舊服務本身的哪一段資料處理不相容。

## 修正

本案例沒有可驗證的 Wine 端修正，採取的是安全回退：

1. 停止所有 Launcher、遊戲與測試服務程序。
2. 刪除或隔離測試 prefix，不覆蓋原本可進大廳的 prefix。
3. 還原原始 `NMService.exe`，不要留下 stub 或第三方替代檔。
4. 後續若需要實際賽事，先用 Windows VM 或雙系統驗證；Wine 端則另開研究環境處理相容性。

## 驗證

- 基準 prefix：Launcher 可以登入並進入大廳。
- 測試 prefix：只有在成功完成實際賽事後，才能視為相容性調整有效。
- 服務檔：還原後以 checksum 或可信來源的原始檔確認未被測試替代。
- Workspace：關閉殘留 Launcher／Wine 視窗，移除大型暫存 log，確認有足夠磁碟空間供 prefix 與 dump 寫入。

## 下次先查

1. 分清楚 Launcher 顯示成功與「已進入實際賽事」。
2. 先取得最新 dump，確認 faulting module 是否為 `NMService.exe`。
3. 建立 prefix 副本後，一次只改一項；每次都以進實際賽事作驗收。
4. 同一個 `NMService.exe` access violation 持續出現時，停止堆疊 DXVK／DLL workaround，改做 Windows 環境交叉驗證或針對服務相容性研究。
