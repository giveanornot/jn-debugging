---
title: Docker 升級 Artalk 並安全備份 SQLite 留言資料
description: Artalk Docker 升版前以 SQLite online backup 保留可回復資料，釘選版本並核對留言資料與公開前端。
date: 2026-10-26
tags:
  - artalk
  - docker
  - sqlite
  - deployment
status: fixed
system: artalk
severity: medium
aliases:
  - Artalk Docker upgrade
  - Artalk SQLite backup
---

## 快速結論

不要直接把 `latest` pull 下來就重建 Artalk。先讀目標 release 的 migration notes、把 image 釘到明確 tag，並對 bind-mounted SQLite 做 online backup。升級後同時驗證 Artalk version、SQLite integrity、資料筆數與公開的前端資產。

若主機沒有 `sqlite3` CLI，Python 標準庫的 `sqlite3.Connection.backup()` 就能建立一致的 SQLite snapshot，不必為備份額外安裝套件。

前後端應使用相同 release。v2.10.1 調整訪客身分驗證並修補前端內容過濾；舊 client 即使仍能讀取留言，也尚未套用這些前端修正，訪客站內通知亦可能受影響。

## 症狀

- Docker Compose 的 Artalk image 沒有 tag，無法從設定看出下次重建會升到哪個版本。
- 後端升版後，網站仍可能從 CDN 載入舊版 `Artalk.js`。
- 想備份 `/data/artalk.db` 時，主機不一定安裝 `sqlite3`。

## 影響範圍

- Service: Artalk self-hosted comment service
- Storage: bind-mounted SQLite database、設定檔與 keyword 檔
- User-visible impact: 留言區短暫重建；前後端版本不一致時可能出現相容性警告或功能缺失
- Data risk: 未做一致備份就升級，會失去快速 rollback 路徑

## 排查

先確認實際容器、版本、掛載與目標 release；不要依搜尋摘要或 repository 首頁 metadata 判斷最新版本。

```bash
docker compose ps
docker compose exec artalk artalk version
docker inspect artalk --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
```

讀目標 release notes，特別看 migration 與 breaking changes。若部落格將 client 固定在 CDN，還要檢查 rendered HTML 中的 `Artalk.js` / `Artalk.css` 版本。

## 根因

Artalk 的容器映像、server binary 與前端 client 是不同的更新面。未加 tag 的 image 會讓部署版本漂移；只升 server 則舊版 CDN client 不會自動更新。SQLite 雖是單一檔案，但在服務運作時直接複製不一定是可驗證的 snapshot。

## 修正

### 1. 建立可回復備份

先備份 compose 與 Artalk 設定。對 SQLite 使用 online backup：

```bash
backup_dir=backups/$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup_dir"
cp -p docker-compose.yml data/artalk.yml data/keywords_*.txt "$backup_dir/"

python3 - "data/artalk.db" "$backup_dir/artalk.db" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as source, sqlite3.connect(sys.argv[2]) as target:
    source.backup(target)
PY
```

若主機沒有 Python，也可暫停指定的 Artalk container 後複製資料庫；不要在未確認工具行為時把空的 CLI export 當成有效備份。

### 2. 釘選版本並只重建 Artalk

把 compose 的 image 改為明確 release tag，例如：

```yaml
services:
  artalk:
    image: artalk/artalk-go:2.10.1
```

然後只更新該 service，不影響同機其他 containers：

```bash
docker compose config --quiet
docker compose pull artalk
docker compose up -d --no-deps --force-recreate artalk
```

### 3. 對齊前端 client

若 Hugo 或其他網站固定使用 CDN，將 `artalk@<old-version>` 的 CSS 和 ESM import 一併換成相同 release。新功能如 page voting 仍需在網站模板放入對應按鈕元素；升 server 不會自動修改文章頁 HTML。

例如更新至 v2.10.1 時，兩個資產都要更新並重新發布網站：

```text
https://cdn.jsdelivr.net/npm/artalk@2.10.1/dist/Artalk.css
https://cdn.jsdelivr.net/npm/artalk@2.10.1/+esm
```

Hugo Stack 可從專案的 `data/external.toml` 覆寫 CDN 版本；先查既有設定，避免直接修改 theme 的 module cache。

依 [v2.10.0 至 v2.10.1 的原始碼差異](https://github.com/ArtalkJS/Artalk/compare/v2.10.0...v2.10.1)，新版 client 會以 `X-Artalk-Guest` header 傳送瀏覽器訪客憑證，供後端判斷對應留言與站內通知的擁有權。2.10.0 client 不會傳送此憑證，因此匿名留言的站內通知可能無法顯示；這與 Email 寄送通知是不同路徑。新版 client 也限制留言中的 `data:` URL 只用於允許的點陣圖片，僅更新後端不會更新瀏覽器執行的內容過濾程式。

## 驗證

```bash
docker inspect -f '{{.State.Status}} restarts={{.RestartCount}}' artalk
docker compose exec artalk artalk version
```

核對 live database 與備份都可讀、且主要資料筆數一致：

```bash
python3 - "data/artalk.db" "$backup_dir/artalk.db" <<'PY'
import sqlite3
import sys

for path in sys.argv[1:]:
    with sqlite3.connect(path) as db:
        print(path, db.execute('PRAGMA integrity_check').fetchone()[0])
        print('comments', db.execute('SELECT count(*) FROM comments').fetchone()[0])
PY
```

最後從外部確認 Artalk dashboard／sidebar redirect 正常，並確認 `/dist/Artalk.js` 與實際嵌入網站的 client version 都是預期版本。

資料筆數只涵蓋數量。若要確認內容未變，針對備份與 live database 的既有欄位，以 `typeof` 搭配 `hex(CAST(column AS BLOB))` 做固定排序的資料指紋比較；避免因 legacy TEXT 含無效 UTF-8 而漏驗或改寫資料。頁面瀏覽計數等仍會被線上流量更新的欄位須另行判讀。

從實際部落格各選一個留言板與一般文章頁，檢查留言顯示、載入更多、回覆／取消及 Markdown 預覽，並讀取瀏覽器 console。測試輸入完要清空草稿。未實際送出留言、登入或驗證站內通知時，明確保留這些驗收缺口。

一次 2.10.0 client／2.10.1 server 的實頁驗證中，留言載入、更多、回覆介面與預覽正常，頁面同時顯示版本警告。這些結果只支持已測功能可用；前端同步更新與發布仍須另外完成。

## 下次先查

1. 直接開官方目標 release page，讀 breaking changes。
2. 看 compose image tag、running version 和網站實際載入的 client version。
3. 先做 SQLite online backup，再 pull／recreate 單一 Artalk service。
4. 用 integrity check、筆數、公開 HTTP 與 container logs 驗證。
