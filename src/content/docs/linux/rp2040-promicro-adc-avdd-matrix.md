---
title: RP2040 Pro Micro GP26–GP29 上拉失效與 Vial 回到 BOOTSEL
description: 排查 HW-467AB 相容控制器的 ADC_AVDD 供電異常、矩陣誤觸和 Vial 重啟。
date: 2026-11-16
tags:
  - rp2040
  - vial
  - qmk
  - keyboard
status: investigating
system: RP2040
severity: medium
aliases:
  - HW-467AB GP26 GP27 GP28 GP29 pull-up
  - Lily58 Vial RPI-RP2 開機後重新出現
---

## 快速結論

部分 HW-467AB RP2040 Pro Micro 控制器的 ADC_AVDD 供電異常，GP26–GP29 設成上拉輸入仍為低電位，可能造成矩陣誤觸。先確認 GPIO 與 ADC_AVDD，別只重刷韌體。類似板子的電阻與電容裝配錯誤有報告，但不能只靠外觀斷定每片根因。

## 症狀與範圍

Lily58 rev1 的 Vial 韌體燒錄後，USB 短暫顯示為 Lily58，再回到 `RPI-RP2`；Vial 可能顯示 `failed to communicate with the device`。普通 QMK 或 MicroPython 可以啟動，不代表所有 GPIO 正常。RP2040 CE 腳位定義的 F6、F7 對應 GP27、GP26，Lily58 rev1 使用這兩腳讀取矩陣欄位。

## 排查

1. 用 USB 日誌確認是否先出現鍵盤，再回到 RP2 Boot；UF2 複製後磁碟消失本身是正常行為。
2. 確認控制器腳位與 `CONVERT_TO=rp2040_ce` 相容，並以已知可啟動的 MicroPython 比較；不要靠 GPIO 編號或腳位數推斷完整相容。
3. 控制器脫離 PCB、不接外部線路時，在 MicroPython REPL 執行：

```python
from machine import Pin
import time
pins = [4, 5, 6, 7, 8, 9, 26, 27, 28, 29]
inputs = [Pin(n, Pin.IN, Pin.PULL_UP) for n in pins]
time.sleep_ms(500)
print({n: p.value() for n, p in zip(pins, inputs)})
```

重複以 `Pin.PULL_DOWN` 測試並再切回上拉。此案例修復前 GP4–GP9 上拉為 1、下拉為 0；GP26–GP29 上下拉都為 0。兩片有相同現象。未接線時上拉讀 0 是診斷線索，不直接證明元件損壞。

4. 比較矩陣掃描開啟與停用的 Vial 診斷韌體：此案例停用掃描後可穩定枚舉並回覆 VIA 版本。診斷版不能用來測按鍵。
5. 若有可靠電表與細探針，可對照 GND 量 3.3V 和 ADC_AVDD（RP2040 第 43 腳）；避免探針跨接相鄰焊盤。ADC_AVDD 為 0V 需先核對接點、板型與線路。低電量電表的電壓與電阻讀值未經校驗不可視為確定。

## 根因與修正

ADC_AVDD 供電與 GP26–GP29 輸入的異常相符；未取得可靠的斷電連通量測，沒有確認哪一顆元件裝錯或短路。使用者自行拆除兩顆元件並將 ADC_AVDD 直接接 3.3V 後，兩片 GPIO 上下拉均恢復；這不是已驗證的原廠修復程序，未確認拆除元件種類與布局。

RP2040 官方允許 ADC_AVDD 與 IOVDD 使用相同 3.3V 供電，並建議在 ADC_AVDD 近旁以 100 nF 電容對地去耦。若拆除後無其他去耦電容，應補足並確認線路；不可在未排除 ADC_AVDD 對地短路時直接跨接電源。詳見 [RP2040 datasheet §2.9.5](https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf)。

## 驗證與限制

- 兩片修後 GP26–GP29 上拉／下拉／再次上拉分別為 1／0／1。
- 內部溫度 ADC 原始值一片約 13700；另一片曾為 65535 或固定 32759，類比供電／轉換尚未確認。
- 使用者確認正常 Vial 版本的空控制器保持 USB 連線，至少一次 VIA 版本查詢正確；後續查詢回覆不一致，通訊穩定性未完成驗證。
- 兩片均拆除元件且未補電容；未裝 PCB，未測完整矩陣、左右通訊、長期穩定性或修復可靠度。

## 下次先查

先測四個腳位的上拉，再核對 ADC_AVDD 供電與去耦。PCB 到貨後使用 Matrix Tester 實測全部按鍵與兩半通訊；對於同樣症狀也須排除焊接、腳位配置或其他電源問題。
