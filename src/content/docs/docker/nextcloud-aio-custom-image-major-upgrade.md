---
title: Nextcloud AIO 自訂映像跨版升級時 Permission denied
description: A custom Nextcloud AIO image can fail its intermediate major-version upgrade when the extracted application tree has the wrong ownership or a test override disappears during rsync.
date: 2026-11-02
tags:
  - nextcloud
  - aio
  - docker
  - upgrade
status: fixed
system: nextcloud
severity: high
aliases:
  - Nextcloud AIO mv Permission denied
  - Nextcloud AIO custom image ownership
  - Nextcloud AIO upgrade rsync config removed
---

## 快速結論

自訂 AIO Nextcloud 映像以官方 release tarball 取代 `/usr/src/nextcloud` 後，若檔案 owner 不符官方 AIO 映像，跨兩個主要版本時的中間版準備可能在 `mv` 時報 `Permission denied`。比對實際官方基底的 owner，並在建置時設定正確權限；本例基底為 UID 33、GID 0。先在隔離複本完整測 AIO 流程，不以單次 `occ upgrade` 成功取代驗證。

## 症狀與排查

舊版正式站正常，隔離副本使用自訂目標映像啟動跨版升級時，AIO 下載、驗證中間版後，在搬移映像程式樹卡住：

```text
mv: cannot remove '/usr/src/nextcloud/...': Permission denied
```

比對官方基底與候選映像內 `/usr/src/nextcloud` 的 UID、GID，並確認程序身分與父目錄權限。tarball 帶入的擁有者不保證符合容器以非 root 執行的預期；`mv` 在 overlay 上也可能涉及複製與刪除，不能只檢查目標資料夾是否可寫。

## 修正與測試

在建置階段保留 AIO 自有 app／設定，驗證官方 release 簽章後解開檔案，將程式樹設成**該基底實際使用**的 owner。不要盲目套用不同映像的 UID/GID，也不要以修改正式 data volume 的權限代替。重建映像後確認 PHP／FPM、必要模組與安全修補仍存在。

先用離線或內部網路的隔離資料庫、Redis 與獨立 volumes 還原備份，禁止連到正式資料庫或發送外部郵件。跨兩個 major 時，AIO 會先用中間版；本例須從目標映像重新建立 container 才能繼續下一個 major，直接重啟會保留前一階段的可寫層。測試應涵蓋應用程式更新及重新啟用、資料庫狀態與使用者檔案雜湊。

隔離設定若寫在額外的 `*.config.php`，注意 AIO 升級時的 `rsync --delete` 可能移除它。測試時在同步後恢復隔離設定，並確認資料庫、Redis 和應用商店仍指向隔離服務；這是測試環境的修正，不應套到正式環境。

## 回復與驗證

正式升級前進入維護模式、阻止新寫入，建立並驗證異機資料庫與資料備份，預留足夠空間及可行的回復程序。升級過程記錄各階段，完成後檢查 `occ status`、原有 apps、容器健康、網站與資料；互動式同步、編輯或白板協作須另行實測。本例在隔離環境及正式環境皆成功逐版升級，使用者檔案雜湊一致；不代表所有外掛或登入後工作流程已驗證。

不要把自訂映像當成上游永久修補。AIO 或上游更新重建容器時，重新檢查實際映像、PHP 與依賴版本及安全設定。
