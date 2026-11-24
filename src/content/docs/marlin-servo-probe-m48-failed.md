---
title: Marlin 伺服式 Z 探針的 M48 失敗與 Z offset 重校
description: 先在 Z 軸停住時驗證探針觸發和噴嘴間隙，再判讀 M48 的回原點前置檢查與探測錯誤。
date: 2026-11-24
category: 3d-printing
tags:
  - marlin
  - 3d-printing
  - ramps
  - z-probe
  - m48
status: fixed
system: Marlin 2.0.8.2
severity: medium
aliases:
  - M48 Probing Failed
  - M48 Home XYZ First
  - servo probe z_min TRIGGERED
  - Z Probe Offset M851
---

## 快速結論

可收折的接觸式探針要先驗證兩件事。展開後，`M119` 能看到接觸和釋放。實際觸發時，噴嘴下方仍有間隙。這兩項通過後，再回原點、測重複性和校正 Z offset。

## 症狀

一台 Mega 2560 上的 Marlin 2.0.8.2 使用伺服馬達展開 Z 探針。韌體角度讀值有變，舵臂一開始沒動，`z_min` 維持 `TRIGGERED`。接頭拆測後重試，舵臂開始動作。後續調校過程中，`M48` 出過兩種回應。

~~~text
Home XYZ First
~~~

~~~text
M48 Z-Probe Repeatability Test
Error:Probing Failed
~~~

## 排查

1. 讀取 `M115`、`M119`、`M503` 留下基準。每次開啟 USB 序列埠時，該主板曾回報 `External Reset`。同一個瀏覽器連線先完成回原點，再跑 `M48`。
2. 先用 `M280` 測伺服，Z 軸不用移動。此機使用 `M280 P0 S40` 展開，`M280 P0 S0` 收回。這兩個角度是此機的韌體值。單獨 `M280 P0` 查到的是韌體最後指定的角度，舵臂是否真的轉動要看實機。[Marlin M280](https://marlinfw.org/docs/gcode/M280.html)
3. 伺服插座量到約 5 V。中間接頭拔開時量到的供電只涵蓋空載。馬達端脈波與接頭是否為原先沒動的原因，當時仍無法確定。
4. 冷機、噴嘴抬高、探針展開時，用平板模擬床面，保持平行並緩慢靠近。用 `M119` 讀到 `open → TRIGGERED → open`。收回時 `z_min` 顯示 `TRIGGERED`，本例要在展開狀態判讀開關。第一次平板測試報觸發時也碰到噴嘴，先暫緩用熱床做自動探測。
5. `Home XYZ First` 出現在開始探測前。`Probing Failed` 出現在探測執行中，可能是觸發太早、一直沒觸發，或探針展開收回遇到問題。末尾位置是清理後的停靠讀值。查 `M503` 才發現先前把四角紙測的 Z 座標直接填入 `M851`，而 `M206` 仍有另一組偏移。[Marlin 2.0.8.2 探測程式碼](https://github.com/MarlinFirmware/Marlin/blob/2.0.8.2/Marlin/src/module/probe.cpp#L546-L579)

## 修正

- 確認探針能展開與釋放，再調整機械接觸腳，讓它先於噴嘴碰床。改過接觸腳之後重測觸發間隙。回原點前移開紙和工具，並在現場監看。
- 對照 `M206` 的座標偏移和 `M851` 的探針偏移。本例的韌體原生 Z 基準是 0。紙測時先建立已知的偏移與補償狀態，在探針回原點碰床的同一個位置，用噴嘴慢慢靠近紙張，確認輕微阻力。保留軟限位的狀態，若量測曾暫時解除，結束立即恢復。完成後以實測值設定 `M851`。[Marlin Z Offset 紙測](https://marlinfw.org/docs/features/z_offset_babystepping.html#measure-the-offset-with-paper)
- 回原點與 Z 零點都可用後重新量網格。列印起始碼若以 `G28` 回原點，可以接 `M420 S1` 啟用已量好的網格。[Marlin M420](https://marlinfw.org/docs/gcode/M420.html)

## 驗證

- `M48` 成功回報極差 0.009 mm、標準差 0.002801 mm。這組數據表示同一點的探測重複性。
- 校正後讀回 `M851 Z-0.30`、3×3 雙線性網格和 `Bed Leveling ON`。最後一次 `Auto Home` 後，使用者確認靠近床中央 `Z=0` 時紙張微擦。
- 實際出絲、首層與 EEPROM 儲存回應留待確認。探針重複性、床面網格和紙測各有獨立的驗收結果。

## 下次先查

先在噴嘴抬高時用 `M119` 核對探針展開、觸發及放開的訊號，接著查機械間隙。報 `Home XYZ First` 就回到座標基準。已開始探測才失敗，先看實機動作與目前設定，再決定是否重跑。驗證後可用 `M48 P5 E V2` 逐筆列出取樣，並在每次取樣之間收回探針。[Marlin M48](https://marlinfw.org/docs/gcode/M048.html)
