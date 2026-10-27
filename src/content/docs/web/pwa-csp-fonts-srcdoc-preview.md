---
title: PWA 的 CSP 擋住字型、Cloudflare 腳本與 srcdoc 預覽
description: 將 CSP 錯誤分成內嵌字型、CDN 注入與預覽腳本，並用實際操作避免只消除 Console 訊息卻留下假網址分享。
date: 2026-10-27
tags:
  - pwa
  - csp
  - cloudflare
  - iframe
status: fixed
system: web
severity: medium
aliases:
  - Loading the font violates Content Security Policy
  - about srcdoc inline script blocked
---

## 快速結論

同一份 Console 截圖可能同時出現多個根因。這次是 PWA 沒有允許內嵌字型、Cloudflare 注入的內嵌腳本與 CSP 衝突，以及預覽 renderer 帶入公開分享腳本。逐項核對來源，不要直接加入 `unsafe-inline`。

## 症狀

- `Loading the font 'data:...' violates ... default-src 'self'`。
- `Executing inline script violates ... script-src`，來源包含首頁與 `about:srcdoc`。
- 消除 CSP 錯誤後，預覽的「分享網址」仍可能分享 `https://preview.local/...`。

## 影響範圍

字型被擋可能影響 Framework7 圖示。腳本錯誤分別影響 Cloudflare 偵測及預覽分享，不能由錯誤數量推斷整個 App 或資料儲存已損壞。本案原本另一個面板大片空白的回報仍未重現，未把它當成同一根因。

## 排查

1. 取得正式 HTML 與 response headers，比對本機 build、CSP meta 與所有 script。
2. 在 CSS 找 `@font-face`，確認來源實際為 `data:`。
3. 檢查預覽 iframe 的 `srcdoc` 與 renderer；對照 CSP hash，不能把所有內嵌腳本都當成同一支。
4. 使用乾淨 Chrome 重現修前錯誤，再測修後。
5. 實際建立文章／短文、開啟預覽並點導覽及分享；不能只以 Console 清空判定完成。

## 根因

未設定 `font-src` 時，字型會受 `default-src` 限制；`img-src data:` 並不涵蓋字型。[MDN 說明](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/default-src)

Cloudflare JavaScript Detections 會注入腳本，只有 meta CSP 的靜態頁不能直接依賴 Cloudflare 解析 response CSP nonce。Cloudflare 文件也說明 origin 的 `Cache-Control: no-transform` 可阻止這項注入。[Cloudflare 說明](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/)

預覽沿用公開 renderer，卻包含 placeholder URL 與公開分享腳本。單純允許腳本執行會讓錯誤消失，但仍分享無效網址。

## 修正

配置層針對已確認的字型來源加入：

```text
font-src 'self' data:;
```

若此靜態 App 不依賴 JSD 結果，Pages `_headers` 可保留 HTML、不讓 CDN 注入這段腳本：

```text
/*
  Cache-Control: public, max-age=0, must-revalidate, no-transform
```

若站點確實依賴 JSD，應改按官方文件配置 response CSP nonce，不能照抄停用注入。

程式層將預覽導覽移至同源外部 JavaScript，納入 service worker precache；移除預覽不需要的公開分享腳本，停用預覽分享鈕並提供提示。正式公開頁保留分享功能，PWA 不再需要該內嵌 script hash allowlist。

`srcdoc` 的 `location.origin` 可能是字串 `null`；本案未 sandbox 的同源預覽，以 `parent.location.origin` 設定 `postMessage` 目標，並實測父頁有收到導覽事件。

## 驗證

- 型別檢查、完整測試與 production build 通過。
- 正式 HTML 與測試 build 完全一致；response 含 `no-transform`，不再出現 Cloudflare 注入。
- 正式站隔離 profile 實際操作兩主題 × 文章／短文，字型載入、四個導覽入口及分享停用都通過，Console errors 為空。
- 以實際 renderer 產生的獨立公開頁 fixture，在 user gesture 下驗證 Clipboard 複製出正確 canonical URL。沒有發布使用者內容或發送社群。

## 下次先查

先分腳本／字型／iframe，再比對實際來源和有效 CSP。修正後重跑可見功能；Console 安靜只是一項證據。
