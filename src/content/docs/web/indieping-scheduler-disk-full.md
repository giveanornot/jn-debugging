---
title: IndiePing scanner 靜默停跑
description: A scheduler can look healthy while disk full makes SQLite writes and journald logging fail, leaving almost no useful logs.
date: 2026-04-30
tags:
  - indieping
  - sqlite
  - scheduler
  - disk
status: fixed
system: indieping
severity: high
aliases:
  - scanner stopped silently
  - SQLite disk full
  - journald disk full
---

## 快速結論

Scheduler 靜默停跑、log 又很少時，先查 disk。這次不是 event loop 卡住，而是 server disk 滿，SQLite 寫入失敗，journald 也因空間滿而記不下錯誤。

程式層 timeout fix 可以保留，但真正恢復是清出磁碟空間。

## 症狀

- scanner 21 小時沒有更新。
- process / scheduler 看起來沒有明顯 crash。
- log 只有很少幾行，沒有足夠 traceback。
- 手動跑 scanner 清空間後恢復。

## 影響範圍

- 服務：IndiePing / feed scanner
- 儲存：SQLite
- 影響：feed 掃描停跑，資料不更新
- 資料風險：中；SQLite 寫入失敗時可能丟失該輪掃描結果

## 排查

先看 disk：

```bash
df -h
journalctl --disk-usage
```

再看 scanner log：

```bash
journalctl -u indieping-scanner --since '24 hours ago'
```

手動跑 scanner 時，注意 SQLite write error 或任何 `No space left on device`：

```bash
npm run scanner
```

如果 log 幾乎沒有，但 disk 已滿，要先把 journald 也視為失效，不能用「log 沒錯」排除系統層問題。

## 根因

server disk 滿造成 SQLite 無法寫入，同時 journald 也無法保存錯誤。這形成雙重靜默：應用寫不進資料，系統也記不下足夠 log。

原先懷疑的 fetch hang / closure variable 不是主因；最多是防禦性改善。

## 修正

先清出磁碟空間，讓 SQLite 與 journald 恢復正常。

程式層可補 fetch hard timeout，避免慢站台拖住 worker：

```js
const response = await fetch(url, {
  signal: AbortSignal.timeout(30000),
});
```

注意這是防禦性修正，不是本次根因修正。

## 驗證

- `df -h` 有足夠空間。
- `journalctl` 可正常寫入新 log。
- `npm run scanner` 手動跑完。
- SQLite database 更新時間與內容有變動。
- 下次 scheduler 週期有自動更新。

## 下次先查

任何 scheduler 靜默停跑：

1. `df -h`
2. `journalctl --disk-usage`
3. 手動跑一次 job
4. 確認 SQLite / DB write 成功

log 很少不是「沒有錯」，可能是 log 系統也沒空間寫。
