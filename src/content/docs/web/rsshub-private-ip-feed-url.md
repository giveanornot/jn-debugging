---
title: RSSHub feed URL 指到 private IP 被 RSS reader 拒絕
description: RSS readers and feed validators may block private or reserved network URLs to prevent SSRF; publish RSSHub through a public origin instead.
date: 2026-07-14
tags:
  - rsshub
  - rss
  - ssrf
  - reverse-proxy
  - self-hosted
status: fixed
system: rsshub
severity: low
aliases:
  - private network RSS URL
  - reserved network feed URL
  - RSSHub private IP
---

## 快速結論

RSS feed parser 顯示「This address points to a private or reserved network」時，不一定是 RSS XML 壞了。很多 reader / validator 會阻擋 private IP、localhost、link-local、reserved range，避免 SSRF。

把 RSSHub route 發布在公開 domain / reverse proxy 後，再用公開 URL 訂閱。不要把 reader 的 RSS URL 指到 LAN IP。

## 症狀

手動打內網 RSSHub route 可以成功，但 feed reader 或 parser UI 拒絕訂閱。

錯誤訊息類似：

```text
This address points to a private or reserved network.
```

範例型態：

```text
http://<private-ip>:1200/dcard/<board>
```

## 影響範圍

- Service：RSSHub
- Client：RSS reader、RSS parser、feed validator
- 影響：使用者無法從該 client 訂閱 feed
- Data risk：無資料毀損

## 排查

先確認 route 本身不是壞掉：

```bash
curl -sS -D /tmp/feed.headers \
  'http://<private-ip>:1200/dcard/<board>' \
  -o /tmp/feed.xml

awk 'NR==1 {print}' /tmp/feed.headers
grep -o '<item>' /tmp/feed.xml | wc -l
```

如果內網直接打是 `200 OK` 且有 items，但 reader 拒絕 URL，再檢查 URL host 是否是：

- RFC1918 private IP，例如 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`
- `localhost` / `127.0.0.1`
- link-local / reserved address
- 只有內網 DNS 才能解析的 hostname

用公開入口再測一次：

```bash
curl -sS -D /tmp/public.headers \
  'https://rsshub.example.com/dcard/<board>' \
  -o /tmp/public.xml

awk 'NR==1 {print}' /tmp/public.headers
grep -o '<item>' /tmp/public.xml | wc -l
```

## 根因

RSS reader 抓 feed 時會從自己的 server 發 HTTP request。若允許使用者提交 private IP URL，攻擊者可以利用 reader 去掃描或存取 reader 所在網路的內部服務，這是 SSRF 風險。

因此很多 reader 會在 fetch 前就拒絕 private / reserved network。這種錯誤不是 XML parse error，也不是 route response body 錯；是 URL 安全政策。

## 修正

把 RSSHub 放到公開入口，例如：

```text
https://rsshub.example.com/dcard/<board>
```

常見做法：

- reverse proxy 指到 RSSHub container
- 讓 RSSHub 加入 proxy 使用的 Docker network
- 保留健康檢查，但不要對外暴露 raw private port 作為訂閱 URL
- 更新 feed reader 中的訂閱 URL

如果服務從一台主機遷到另一台，先驗證公開入口，再停掉舊主機上的服務，避免 reader 繼續打到私有 URL。

停舊服務的檢查樣式：

```bash
systemctl --user disable --now rsshub.service
systemctl --user is-active rsshub.service || true
ss -ltnp | grep ':1200' || true
```

## 驗證

公開 healthcheck：

```bash
curl -fsS https://rsshub.example.com/healthz
```

公開 route：

```bash
curl -sS -D /tmp/rss.headers \
  'https://rsshub.example.com/dcard/<board>' \
  -o /tmp/rss.xml

awk 'NR==1 {print}' /tmp/rss.headers
grep -o '<item>' /tmp/rss.xml | wc -l
```

預期：

```text
HTTP/2 200
items > 0
```

再把同一個公開 URL 貼進 RSS reader / validator 測試。

## 下次先查

看到 private network / reserved network 錯誤時，先不要 debug RSS XML。

最短路徑：

1. `curl` 內網 URL，確認 route 本身正常。
2. 看 reader 拒絕的是 URL policy 還是 HTTP response。
3. 改用公開 HTTPS domain。
4. 從本機與 reader 端都測公開 URL。
5. 若已搬家，停掉舊內網服務避免混淆。
