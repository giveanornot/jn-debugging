---
title: JLCONE 在 COSMIC Wayland 無視窗或登入欄位裁切
description: JLCONE 的 bundled Electron 在 COSMIC Wayland 中開窗失敗或只顯示登入宣傳圖時，辨識 Xwayland 未映射與 WebContentsView 合成問題，並以每個 App 的 Wayland／軟體合成 launcher 迴避。
date: 2026-10-02
tags:
  - linux
  - jlcone
  - electron
  - cosmic
  - wayland
status: investigating
system: JLCONE / COSMIC Wayland
severity: low
aliases:
  - JLCONE blank login screen Linux
  - JLCONE login form missing
  - JLCONE WebContentsView Wayland
  - jlcone-bin COSMIC
---

## 快速結論

JLCONE 的 Linux binary 內含 Electron，而不是使用發行版的 Electron。某些 COSMIC Wayland 環境中，預設 Xwayland 路徑會讓程序存在但主視窗沒有 map；改為原生 Wayland 後，登入頁可能只顯示左側宣傳圖，Username、Password 與 Sign In 則被嵌入式 `WebContentsView` 的合成問題裁掉。

先只替 JLCONE 建立 user-level launcher，加入 `--ozone-platform=wayland --disable-gpu`。這不會變更全域 Electron、GPU 驅動或 compositor。必須以實際畫面確認登入欄位可見且可操作；程序存活或 DevTools 已看到表單都不算驗收成功。

## 症狀

- 從應用程式選單點 JLCONE 後沒有視窗，但程序仍持續存在。
- 以原生 Wayland 重新開啟後，視窗可見，卻只有 JLCONE 宣傳圖片或右側空白區。
- 預期應出現的 Username／Email、Password、Sign In 沒有顯示。
- 沒有缺 library、coredump 或明確的登入站台連線失敗。

## 影響範圍

- Linux 的 JLCONE bundled Electron；本次觀察版本為 Electron 35。
- COSMIC Wayland 桌面，AMD 圖形裝置。
- 未登入時的內嵌 JLCPCB Account 頁面。
- 不代表 JLCPCB 帳號、cookie 或網路本身失效。

## 排查

先確認不是已存在的單一 instance 或啟動檔遺失：

```bash
pacman -Qi jlcone-bin
pgrep -a -x jlcone
sed -n '1,80p' /usr/share/applications/jlcone.desktop
```

若是「程序存在但完全沒有畫面」，在 Xwayland 下可檢查主視窗是否根本未映射：

```bash
xwininfo -root -tree | rg -i -C 2 'jlcone'
xwininfo -id WINDOW_ID -all | rg 'Map State|Process id'
```

`Map State: IsUnMapped` 表示不能只因 `pgrep` 有結果就判定開啟成功。

若畫面只剩宣傳圖，暫時以 localhost DevTools 讀取登入頁，而不要曝光到 LAN：

```bash
pkill -x jlcone
setsid jlcone --ozone-platform=wayland --remote-debugging-port=9222 \
  </dev/null >/dev/null 2>&1 &
curl --fail --silent http://127.0.0.1:9222/json/list
```

若 JLCPCB Account target 的 DOM 已經包含可見的 `input[type=password]` 與 `Sign In`，但畫面仍沒有欄位，問題在 Electron child view 的顯示／合成層，而不是帳密或網路。診斷完畢後完整結束程式，避免讓 remote-debugging port 留著。

## 根因

此案例的最小解釋是 JLCONE bundled Electron 的 COSMIC Wayland 相容性問題：

- 預設路徑使用 Xwayland 時，主 BrowserWindow 未被 map。
- 原生 Wayland 能顯示主視窗與登入頁 DOM，但 GPU 合成的 `WebContentsView` 可能沒有正確呈現整個登入頁。

這不是已由上游確認的單一 bug，因此不要把它歸因到特定 COSMIC 或 Electron issue；升級 JLCONE 後仍要重跑原始畫面驗收。

## 修正與回退

以使用者層 desktop entry 覆蓋套件提供的 launcher：

`~/.local/share/applications/jlcone.desktop`

```ini
[Desktop Entry]
Name=JLCONE
Exec=/opt/JLCONE/jlcone --ozone-platform=wayland --disable-gpu %U
Terminal=false
Type=Application
Icon=jlcone
StartupWMClass=jlcone
MimeType=x-scheme-handler/jlcone;
Categories=Development;
```

完整結束舊 instance 後，從選單重新開啟：

```bash
pkill -x jlcone
gtk-launch jlcone
```

確認主程序確實帶入 flags：

```bash
pgrep -a -x jlcone | head -1
```

`--disable-gpu` 只讓此 App 用軟體合成，代價是較低的圖形效能。若新版本已能正常顯示，先刪除 `--disable-gpu`，完整重開後驗證；再考慮移除 user-level desktop entry 回到套件預設值。

## 驗證

- 主程序帶有 `--ozone-platform=wayland --disable-gpu`。
- 視窗內可見 Username／Email、Password 和 Sign In。
- 能輸入帳密、切換 captcha 或登入，而非只停在宣傳圖。
- 關閉後重從應用程式選單啟動，仍走 user-level launcher。
- 本文的 workaround 已確認能啟動視窗與載入表單 DOM；登入欄位的實際視覺驗收仍應由使用者完成，因此頁面維持 `investigating`。

## 下次先查

1. 先查 `pgrep -a -x jlcone`，再查 Xwayland window 的 `Map State`。
2. 不要只看程序或 DOM；以原始截圖確認登入欄位可見。
3. 優先只改 JLCONE 的 user-level launcher，不動全域 Electron／Wayland 設定。
4. 若仍裁切，保留截圖，比較上游 JLCONE 新版；必要時再測 Xwayland 與原生 Wayland。
