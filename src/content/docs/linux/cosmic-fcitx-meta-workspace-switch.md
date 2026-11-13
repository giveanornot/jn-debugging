---
title: COSMIC 切工作區後按住 Meta 卻輸入數字
description: 從 Discord 訊息框切到 ChatGPT 後，第二次按數字變成文字輸入。用 Fcitx5 服務停用測試縮小範圍。
date: 2026-11-13
tags:
  - linux
  - cosmic
  - wayland
  - fcitx
  - keyboard
status: investigating
system: desktop
severity: low
aliases:
  - Super number workspace switch types digits
  - Fcitx5 Meta modifier lost after workspace switch
---

## 症狀

在 Arch Linux 的 COSMIC Wayland 工作階段，焦點放在 Discord 訊息框。按住 Meta 並按數字切到 ChatGPT 所在的工作區。Meta 繼續按住，再按另一個工作區的數字時，數字打進 ChatGPT。每次放開 Meta 再重新按，切換正常。Fcitx5 使用英文輸入時仍可重現。

## 排查

1. 確認 COSMIC 預設的 Super＋數字工作區綁定存在，且沒有自訂設定覆寫。本次環境為 cosmic-comp 1.11.0、Fcitx5 5.1.23。
2. 若使用 keyd，檢查其修飾鍵映射。本次把左 Alt／Meta 交換改為 keyd 建議的 `layer(meta)`／`layer(alt)` 後，仍可重現。
3. 若 Fcitx5 由使用者服務管理，暫停服務並重做相同的視窗焦點和按鍵順序。測完再啟動服務。

```sh
systemctl --user stop fcitx5.service
# 此時重測 Discord → ChatGPT → 下一個工作區
systemctl --user start fcitx5.service
systemctl --user is-active fcitx5.service
```

## 驗證與暫行做法

停用 Fcitx5 時能持續按住 Meta 切工作區，測後已確認服務恢復執行。這將範圍縮小到 Fcitx5 與 COSMIC 的互動。底層事件順序仍未擷取到。若要保留中文輸入，每次切換時放開 Meta 再重新按。

COSMIC 1.11.0 改動過 Wayland 虛擬鍵盤。上游仍在處理輸入法鍵盤接管與修飾鍵狀態。後續更新時應在 Fcitx5 執行中重測原路徑，確認第二次也切換且不輸入數字。跨主機比較時先核對實際運行的 COSMIC、Fcitx5 版本，以及兩個應用程式的 Wayland／XWayland 後端。 [COSMIC 1.11.0 發行紀錄](https://github.com/pop-os/cosmic-epoch/releases/tag/epoch-1.11.0) · [虛擬鍵盤追蹤 #2959](https://github.com/pop-os/cosmic-comp/issues/2959) · [修正草稿 #2977](https://github.com/pop-os/cosmic-comp/pull/2977)
