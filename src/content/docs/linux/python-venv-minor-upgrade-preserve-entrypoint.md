---
title: Ubuntu 升級後舊 venv 仍綁 Python 3.13
description: Rebuild Python 3.13 virtual environments under Python 3.14, preserve the original entry path, and verify real tool behavior before retiring the old runtime.
date: 2026-10-25
tags:
  - python
  - venv
  - ubuntu
  - migration
  - rollback
status: fixed
system: python
severity: medium
aliases:
  - Python 3.13 to 3.14 venv migration
  - Ubuntu upgrade old Python virtualenv
  - venv absolute shebang rollback
  - Python virtual environment symlink
---

## 快速結論

系統升到 Python 3.14，不代表既有 venv 已跟著遷移。先查舊環境的 interpreter、pyvenv.cfg 與套件，再用新 Python 在最終位置重建，驗證後才讓原入口指向新環境。

保留舊環境與它需要的 Python 3.13，才能直接回復。不要只換舊環境的 python symlink，或把已建好的新環境搬到另一個路徑。

## 症狀

- 系統 python3 已是 3.14，但舊工具的 venv/bin/python3 仍指向 /usr/bin/python3.13。
- 作業系統升級後必須暫留舊 interpreter，否則舊工具失去可用 runtime。
- 工具仍可執行，卻無法安全移除舊 Python 相容套件。
- 直接改 interpreter 可能讓 lib/python3.13/site-packages 不再被載入；含 native extension 的依賴也需要對應新 Python 的版本。

本例是解除舊 runtime 依賴的維護，不是以刪除舊 Python 來重現故障。

## 影響範圍

Ubuntu 升級後的兩個既有工具：RSS reader 與 Wikipedia 查詢環境。正式資料包含 SQLite、RSS cache 與設定；遷移不應觸發正式通知或改寫這些資料。

## 排查

先確認實際啟動的 Python，不只看系統預設版本：

```bash
python3 --version
./venv/bin/python --version
readlink -f ./venv/bin/python
cat ./venv/pyvenv.cfg
./venv/bin/python -m pip list --format=json
head -n 1 ./venv/bin/pip
```

本例兩個環境都仍綁 Python 3.13。確認沒有程序使用它們後，保留套件版本清單，另建 Python 3.14 環境；初期不混入應用依賴升級，方便比較遷移前後行為。

## 根因

venv 以建立時的 base Python 為基礎，不會因系統預設 Python 改版就自動完成遷移。site-packages 路徑、native extension 與 console script 的 interpreter 都可能帶版本或絕對路徑。

[Python 官方文件](https://docs.python.org/3.14/library/venv.html#how-venvs-work) 說明 console scripts 的 shebang 會指向環境內 interpreter，因此一般不能把已建好的環境任意搬移。

## 修正

### 在最終位置重建

以下路徑是通用範例，操作前確認新環境與備份名稱尚未存在：

```bash
./venv/bin/python -m pip freeze > requirements-py313.txt
python3.14 -m venv ./venv-py314
./venv-py314/bin/python -m pip install --no-cache-dir -r requirements-py313.txt
./venv-py314/bin/python -m pip check
```

依賴若不支援新 Python，先處理相容性，不繼續切換。本例原應用套件版本可在 Python 3.14 安裝，未順便升級 SDK。

### 驗證後保留原入口

```bash
# 先停止會使用此環境的程序，並完成下節的功能驗證。
mv ./venv ./venv-py313-backup
ln -s venv-py314 ./venv
./venv/bin/python --version
./venv/bin/python -m pip check
```

新環境一直留在建立時的位置；原路徑只是相容入口。服務、排程或既有命令可沿用原路徑。Git 專案應同時忽略新環境、備份與入口 symlink；只寫 venv/ 不足以忽略名為 venv 的 symlink，可用根目錄的 /venv 規則。

### 回復

```bash
# 確認 venv 是本次建立的 symlink，並停止相關程序後才操作。
test -L ./venv && unlink ./venv
mv ./venv-py313-backup ./venv
./venv/bin/python --version
```

舊 console scripts 的 shebang 仍指向原 venv 路徑，因此回復時要把舊目錄放回原名。不要直接執行改名後備份目錄的 pip，誤以為它一定使用備份環境。

本例保留舊 Python 套件供回復，沒有執行 apt remove 或 autoremove；清理舊 runtime 是另一個需要核對使用者與回復方式的步驟。

## 驗證

對舊 Python、新環境與切換後原入口執行同一組檢查：

- 套件版號一致；含 native extension 的依賴可載入，pip check 通過。
- RSS reader 經本機 HTTP fixture 驗證抓取、日期篩選、HTML 解碼與 ETag 304；SQLite 寫入與去重正常。
- 原 CLI 在停用通知的測試設定下連跑兩次，只保存一篇；原統計命令可讀正式 DB 副本。
- Wikipedia 套件實際執行 search、summary 與 HTML 解析，並非只測 import。
- 正式 SQLite、cache 與設定的 SHA256 前後一致。
- 切換後另做公開 RSS 與 Wikipedia 線上唯讀查詢，均成功。

本輪外部通知為零，沒有寄信、社群發文或呼叫付費 LLM；這些投遞能力不在遷移驗證結論內。

## 下次先查

1. 比較系統與原入口的 Python 版本、base interpreter 及 pyvenv.cfg。
2. 保留依賴清單，在新環境的最終位置重建。
3. 用相同資料與工作量驗證原工具，不只測 import。
4. 切換後從原入口再測一次，確認 shebang 與 symlink 實際指向。
5. 保留可回復的舊目錄與 runtime，確認沒有其他使用者後才另排清理。
