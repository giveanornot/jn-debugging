---
title: Example Service 問題摘要
description: One searchable sentence that explains the failure mode.
date: YYYY-MM-DD
tags:
  - service-name
status: fixed
system: service-name
severity: medium
aliases:
  - alternate keyword
---

## 快速結論

用一到三句寫未來最想先看到的答案：根因、修法、避免再踩的重點。

## 症狀

- 使用者看到什麼錯誤。
- 哪個流程中斷。
- 錯誤訊息、HTTP status、log 關鍵行。

```text
Minimal error excerpt goes here.
```

## 影響範圍

- Service:
- Host or environment:
- User-visible impact:
- Data risk:

## 排查

列出實際檢查順序，不寫成事後完美推理。

```bash
example command --with-relevant-flag
```

## 根因

寫最小可驗證解釋：為什麼會壞、為什麼其他假設被排除。

## 修正

寫具體改動。必要時附最小 code block，不貼整段檔案。

```diff
- old behavior
+ new behavior
```

## 驗證

- Build/test command:
- Runtime check:
- Regression check:

## 下次先查

未來遇到類似問題時，最短排查路徑。
