---
title: Hugo 出現 TOCSS-DART 錯誤，找不到 Dart Sass
description: 從 Hugo server 的 TOCSS-DART 錯誤確認 Dart Sass 是否在 PATH，並區分缺少依賴和編譯時的棄用警告。
date: 2026-11-23
category: static-sites
tags:
  - hugo
  - hugo-theme-stack
  - dart-sass
status: fixed
system: Hugo
severity: low
aliases:
  - TOCSS-DART
  - You need to install Dart Sass
  - Hugo server Dart Sass PATH
---

## 快速結論

主題若透過 Hugo 的 Dart Sass 編譯器處理 SCSS，啟動 Hugo 的環境需要能在 `PATH` 找到獨立版 Dart Sass 的 `sass` 執行檔。裝好後用原來的啟動命令重試，再對首頁和文章頁各送一次 HTTP 請求。

## 症狀

`hugo server -D` 在建置時退出。錯誤堆疊可能從 404 頁或分類頁開始，往下看會找到樣式編譯錯誤。

```text
TOCSS-DART: failed to transform "/scss/style.scss" (text/x-scss).
You need to install Dart Sass
```

## 排查

在啟動 Hugo 的同一個終端機或編輯器工作環境執行以下指令。如果 `sass` 只有某個 shell 找得到，也要檢查編輯器啟動工作時繼承的 `PATH`。

```sh
hugo version
command -v sass
sass --version
hugo server -D
```

實測 Hugo 已安裝，原本的啟動命令可以重現錯誤，當時 `PATH` 找不到 `sass`。把獨立版 Dart Sass 放進 `PATH` 後，同一個 Hugo 執行檔就能完成建置。

## 修正

從 [Dart Sass 官方發行頁](https://github.com/sass/dart-sass/releases) 下載對應作業系統和架構的獨立版。保留解壓後的整個目錄，將其中的 `sass` 放進啟動環境的 `PATH`。Linux 可將完整目錄放在使用者的工具目錄，並在已有的使用者 `PATH` 目錄建立指向 `sass` 的符號連結。

## 驗證

本次用 Hugo 0.170.1 與 Dart Sass 1.108.2 驗證。等 Hugo 顯示 Web Server is available 再測，首頁和一篇文章頁均回傳 HTTP 200。

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:1313/
```

如果接下來看到 `DEPRECATED [import]` 或 `DEPRECATED [global-builtin]`，表示 Dart Sass 已經在編譯。一般建置可以成功，Hugo 開啟 `--panicOnWarning` 時會在警告處中止。這兩類語法預計在 Dart Sass 3.0 移除，可在更新主題時檢查是否已遷移。[Sass 官方遷移說明](https://sass-lang.com/documentation/breaking-changes/import/)

## 下次先查

看到 `TOCSS-DART` 搭配安裝提示時，先比對終端機和編輯器工作環境裡的 `command -v sass`，再從原入口測試。如果已經有棄用警告，查看建置有沒有開啟 `--panicOnWarning`。
