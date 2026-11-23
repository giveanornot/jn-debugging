---
title: MK870 在 Linux 連上 sharkfin，卻讀不到原廠改鍵
description: ROYUAN MK870 有線可讀板載鍵位與背光快照。遇到 FL 改鍵讀回差異或 Fn 背光失效時，先核對 USB 裝置身分與當下設定。
date: 2026-11-03
lastUpdated: 2026-11-23
tags:
  - linux
  - keyboard
  - mk870
  - sharkfin
  - webhid
status: investigating
system: sharkfin
severity: low
aliases:
  - FL ESPORTS Linux
  - YC500 keymap readback
  - Caps Lock remap missing
  - /linux/mk870-sharkfin-keymap-readback/
category: keyboards
---

## 快速結論

本案 MK870 有線模式以 `Royuan Gaming Keyboard`、`05ac:024f` 出現。sharkfin 0.11.1 能連線，辨識 device ID 195、YC500 協定，並匯出 4 個設定檔；但沒有呈現使用者先前用 FL 原廠軟體設定的 Caps Lock 改鍵。

只能確認部分通訊可用。sharkfin 尚未收錄這個裝置，套用推測配列 `Common87_M3V5`；實體鍵與內部槽位對應、韌體讀取差異均未釐清。先保存讀取快照，再驗證原廠設定與實體輸出，不用重新改鍵掩蓋讀回問題。

## 症狀

- 網頁顯示 `Gaming Keyboard not in the registry · yc500`。
- Keys → Base → Profile 1 的 Caps Lock 仍顯示 `Caps`，編輯器也顯示 `now Caps`。
- 使用者表示先前已用 FL 改過該鍵；本案未取得原設定的目標功能。
- 同一張表能顯示另一個非預設值，但這不足以驗證每個實體鍵的位置或整體相容性。

## 影響範圍

實測環境為 Arch Linux、COSMIC Wayland、Brave 與 sharkfin 網頁版。結果限於本案的 ROYUAN MK870，不能外推至同名的 Winbond、PRO 或 HE 版本。

[OpenKey 的 MK870 實測文件](https://github.com/BakulBd/OpenKey/blob/main/docs/FL_ESPORTS_MK870.md)針對的是 `0416:c345`。不能只因型號相同，就把它的驗證結果套到 `05ac:024f`。

## 排查

### 分清接收器與有線鍵盤

先用 `lsusb`，再從 sysfs 讀取產品名稱與版本。同一 VID/PID 不一定代表同一條實體連線：

| 連線 | manufacturer | product | VID:PID | bcdDevice |
| --- | --- | --- | --- | --- |
| 2.4G 接收器 | RONGYUAN | 2.4G Wireless Device | 05ac:024f | 0002 |
| USB 有線鍵盤 | Royuan | Gaming Keyboard | 05ac:024f | 0215 |

可用以下唯讀檢查，避免只看 `lsusb` 的 Apple 名稱就誤認硬體：

```python
from pathlib import Path

for dev in Path('/sys/bus/usb/devices').iterdir():
    vendor = dev / 'idVendor'
    if not vendor.is_file() or vendor.read_text().strip() != '05ac':
        continue
    print(dev.name)
    for field in ('idVendor', 'idProduct', 'manufacturer', 'product', 'bcdDevice'):
        path = dev / field
        if path.is_file():
            print(field, path.read_text().strip())
```

在瀏覽器裝置選單選擇 `Gaming Keyboard` 後，sharkfin 成功辨識協定。這次原有裝置權限已足夠，未新增 udev 規則。

後續排查 Fn＋↑／↓ 時，桌機只列出 `bcdDevice=0002`。向接收器送出唯讀狀態及識別查詢，兩者回傳相同資料，未取得鍵盤識別碼或背光參數。要讀當下板載設定，先用 USB 資料線直連、切至有線模式，並確認系統列出 `Gaming Keyboard`（`0215`）。[sharkfin 接收器協定](https://github.com/dniminenn/sharkfin/blob/master/docs/PROTOCOL.md#24-ghz-receiver)

### 保存原始讀取結果

1. 在 Contribute → Collect data bundle 取得唯讀診斷；不必送出 issue。
2. 記錄工具版本、device ID、family、推測配列與目前設定檔。
3. Device → Backup → Export，保存各設定檔的 Base／Fn 表。
4. 用匯出 JSON 比對畫面與原始值，保留「槽位如何對到實體鍵」仍待驗證的限制。

本案結果：

| 資料 | 結果 |
| --- | --- |
| 工具 | sharkfin 0.11.1，build a8d1709 |
| 識別 | device ID 195，YC500，4 profiles |
| 圖形配列 | Common87_M3V5，推測匹配 87/87 |
| 圖上 Caps 候選槽位 | slot 3，四組 Base 都是 `00 00 39 00` |
| 同槽位 Fn 表 | 四組都是 `00 00 00 00` |

依 [sharkfin 協定文件](https://github.com/dniminenn/sharkfin/blob/master/docs/PROTOCOL.md)，Base 與 Fn 表可分別讀回，槽位值各有 4 bytes；實體鍵對應哪個槽位則依鍵盤而異。上述資料只支持「畫面與其所用槽位的讀值一致」，不能證明實體 Caps Lock 沒有改鍵，也不能排除其他韌體區域保存設定。

## 根因

尚未確認。沒有證據判定 FL 未儲存設定、鍵盤恢復預設或 sharkfin 已覆寫設定。推測配列錯位、韌體讀取差異與原廠設定保存位置仍是待驗假說。

同一 VID/PID、能讀出資料、圖形匹配率高，均不能各自證明整體相容。

## 修正

本次完成相容性調查與快照匯出，沒有由操作者重新映射 Caps Lock、匯入設定、恢復原廠或刷韌體。尚無已驗證修法。

若只需要 Linux 主機端改鍵，可另評估既有 keyd；那是另一層的映射，不是修好鍵盤內部設定讀回。

## 驗證

- 已確認 USB 有線裝置出現、WebHID 連線、協定識別、鍵位表讀取及 JSON 匯出。
- 4 組 Base／Fn 表各為 512 bytes，候選 Caps 槽位的原始值與畫面一致。
- 未以實體 Caps Lock 輸出驗證槽位，也未用 FL 原廠讀回做對照；因此快照不能宣稱是完整的原廠設定備份。
- 使用者另反映打字反應慢，並提出可能與軸體有關；未量測延遲或完成換軸測試，不將兩個問題歸為同一根因。

## 下次先查

先確認有線裝置的完整 USB 身分與工具版本，再保存唯讀快照。對照原廠軟體的設定檔／層及實體鍵輸出，釐清候選槽位是否對應正確。找到不一致的位置後，才決定補配列、修讀取協定或改用其他工具。

### Fn 背光快捷鍵間歇失效

1. 在 WIN 模式比較單按 F11 與 Fn＋F11。若組合鍵能降低音量，代表該次按壓有辨識到 Fn。可用 Fn＋F12 調高音量，避開音量已在下限的情況。[MK870 三模版原廠手冊](https://fccid.io/m/d78a9ff8164efcab0081136253864cc6d6dc66e5fb4a9df6c264ac48e5fd46e2.pdf)
2. 若只有背光組合鍵失效，單按 ↑／↓ 確認方向鍵本身有反應。有線連線後，讀取當前背光亮度和作用中的 Fn 層。舊有線快照曾讀到亮度為 0，四組 Fn 表仍包含 ↑／↓ 的亮度動作。後續這次症狀尚未取得新的有線快照。
3. 若音量組合鍵也會失效，可在熱插拔版本關電、拔線後，將 Fn 軸與已確認正常的字母鍵軸互換。故障跟著軸移動就查軸體。故障留在 Fn 位置則查軸座接點與板載 Fn 指定。本案尚未實測換軸，根因仍待確認。
