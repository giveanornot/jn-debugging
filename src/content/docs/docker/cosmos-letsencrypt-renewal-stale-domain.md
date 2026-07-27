---
title: Cosmos Let’s Encrypt 合併憑證因舊網域續期失敗
description: Cosmos Server may fail to renew every routed hostname in one bundled SAN certificate when a stale route points to a domain now served elsewhere.
date: 2026-07-27
tags:
  - cosmos
  - docker
  - lets-encrypt
  - tls
  - dns-01
  - wildcard-certificate
  - certificate-transparency
  - reverse-proxy
status: fixed
system: cosmos-server
severity: high
aliases:
  - Cosmos certificate expired
  - Cosmos LETSENCRYPT_OBTAIN
  - Cosmos acme-tls ALPN failed
  - bundled SAN certificate renewal
  - Cosmos DNS-01 wildcard certificate
  - Certificate Transparency subdomain enumeration
---

## 快速結論

預設模式下，Cosmos 會把管理介面與反向代理路由的 hostname 合併成一張 Let’s Encrypt SAN 憑證。只要其中一個舊網域已搬到另一個平台，卻仍留在 Cosmos 的 route 或 wildcard override，TLS-ALPN-01 驗證就會失敗，整張憑證無法續期。

先從 Cosmos 設定移除不再由它服務的 hostname、舊 route 與 wildcard override，再強制續期並重啟 Cosmos。不要只刪 DNS 或只關閉 route；仍被快取或覆寫引用的 hostname 會繼續加入憑證申請。

若 DNS 由 Cloudflare 等支援 API 的供應商管理，改用 DNS-01 與有限範圍的 wildcard 憑證。之後新增一般子網域 route 不必逐一改 DNS 或重簽個別 SAN，新的主機名也不會出現在新的 Certificate Transparency（CT）紀錄；已簽發的歷史 CT 紀錄無法移除。

## 症狀

- 多個原本正常的自架網域同時顯示憑證到期或 hostname 不符。
- Cosmos log 每日出現續期檢查與 fallback，但沒有新憑證。
- 瀏覽器若已記住 HSTS，會直接拒絕開啟網站。

關鍵日誌通常像這樣：

```text
Checking certificates for renewal
Certificates are not valid anymore, renewing
LETSENCRYPT_OBTAIN : error: one or more domains had a problem:
[old-domain.example] invalid authorization: Cannot negotiate ALPN protocol "acme-tls/1"
Couldn't get TLS certificate. Fallback to previous certificate
```

## 影響範圍

- 服務：Docker 上的 Cosmos Server 與其反向代理路由
- 影響：同一張合併 SAN 憑證涵蓋的網站都可能被瀏覽器拒絕
- 資料風險：低；問題在 TLS 終端與可用性，不會改動後端應用資料
- 特別容易發生：網域移到 Cloudflare Pages、另一台 reverse proxy 或其他主機後，Cosmos 的舊設定沒有一起清掉

## 排查

先確認公開端實際送出的憑證，測試時不要使用 `curl -k`：

```bash
curl -Iv https://service.example
echo | openssl s_client -connect service.example:443 \
  -servername service.example -verify_return_error
```

再看 Cosmos 是否持續續期失敗，並保留失敗 hostname：

```bash
docker logs --since 14d cosmos-server 2>&1 \
  | grep -Ei -A4 -B1 'LETSENCRYPT_OBTAIN|certificate.*renewal|Couldn.t get TLS'
```

Cosmos 的設定檔通常在容器的 `/config/cosmos.config.json`。檢查憑證快取、wildcard override 與 route hosts：

```bash
docker exec cosmos-server cat /config/cosmos.config.json \
  | jq '.HTTPConfig | {
      TLSKeyHostsCached,
      SelfTLSKeyHostsCached,
      OverrideWildcardDomains,
      ForceHTTPSCertificateRenewal
    }'

docker exec cosmos-server cat /config/cosmos.config.json \
  | jq -r '.HTTPConfig.ProxyConfig.Routes[] | [.Host, .Disabled, .Name] | @tsv'
```

對每個 hostname 確認其 DNS 仍指向 Cosmos 所在主機；若已搬走，確認它也不再出現在 route、快取或 wildcard override。

```bash
getent ahostsv4 old-domain.example
```

## 根因

Cosmos 的自動續期確實有執行，但合併憑證是原子操作：一個 SAN 驗證失敗，Let’s Encrypt 就不會簽發新憑證。

舊網域若已改由 Cloudflare Pages 或其他平台提供服務，Let’s Encrypt 連到的不是 Cosmos，因此 Cosmos 無法完成 `acme-tls/1` ALPN challenge。Cosmos 不會根據 DNS 自動刪除舊 route、`TLSKeyHostsCached` 或 `OverrideWildcardDomains`，所以每天會重試、fallback 到舊憑證，直到舊憑證到期。

同時，逐一列入 SAN 的 hostname 會在公開 CT log 中留下可枚舉的紀錄。這不是 DNS 解析或 proxy 設定能回收的資訊；改善點是停止未來逐一簽發，而不是嘗試刪除既有 CT 紀錄。

## 修正

先備份設定。以下範例移除不再由 Cosmos 管理的 `old-domain.example`，並保留其他 hostname：

```bash
docker exec cosmos-server sh -c \
  'cp /config/cosmos.config.json /config/cosmos.config.json.bak-before-cert-renewal'

docker exec cosmos-server cat /config/cosmos.config.json \
  | jq '
      .HTTPConfig.ProxyConfig.Routes |= map(select(.Host != "old-domain.example"))
      | .HTTPConfig.TLSKeyHostsCached |= map(select(. != "old-domain.example"))
      | .HTTPConfig.SelfTLSKeyHostsCached |= map(select(. != "old-domain.example"))
      | .HTTPConfig.OverrideWildcardDomains = "*.example.com"
      | .HTTPConfig.ForceHTTPSCertificateRenewal = true
    ' \
  | docker exec -i cosmos-server sh -c \
      'umask 077; cat > /config/cosmos.config.json.new && mv /config/cosmos.config.json.new /config/cosmos.config.json'

docker restart cosmos-server
```

`OverrideWildcardDomains` 需依實際仍由 Cosmos 管理的網域調整；不要照抄範例後刪掉仍在用的 wildcard。

## 預防：DNS-01 wildcard 與 DNS 整理

DNS 供應商可用 API 驗證時，將 Cosmos 改為 DNS-01。API token 只給必要 zone 的 DNS edit 權限，不要共用帳號全域 API key。以下為概念設定；實際 token 名稱依 DNS provider adapter 而異：

```json
{
  "DNSChallengeProvider": "cloudflare",
  "DNSChallengeConfig": {
    "CF_DNS_API_TOKEN": "limited-zone-dns-edit-token"
  },
  "UseWildcardCertificate": true,
  "OverrideWildcardDomains": "*.example.com,*.dev.example.com,*.homelab.example.com",
  "ForceHTTPSCertificateRenewal": true
}
```

在套用前備份 `/config/cosmos.config.json`，再重啟 Cosmos 讓它建立 DNS TXT challenge 並簽發新憑證。簽發成功後，`ForceHTTPSCertificateRenewal` 應回到 `false`。

DNS 端只需保留對應層級的 wildcard A/AAAA 記錄，並讓 DDNS client 更新這些 wildcard 名稱。兩層子網域需要各自一筆 wildcard，例如 `*.dev.example.com` 不會被 `*.example.com` 覆蓋。

若某個子網域同時有 MX、TXT 等明確 DNS record，wildcard A 不一定會被 DNS wildcard synthesis 套用。為該名稱保留獨立 A/AAAA record，並把它列入 DDNS client 的更新清單。

移除不再使用的 Cosmos route 後，DNS wildcard 本身仍可能讓舊名稱解析到 reverse proxy；這是預期行為。要避免舊服務繼續被轉送，必須同時刪除該 route 或將它改為明確的退役回應。

若 Cosmos 正好在排程續期，強制簽發可能和排程重疊而觸發一次 panic／自動重啟。容器的 restart policy 恢復後，讓單一簽發流程跑完即可；不要在驗證中反覆重啟。

## 驗證

- Cosmos log 顯示各 hostname `The server validated our request`，最後不再出現 `LETSENCRYPT_OBTAIN` error。
- 設定中的 `ForceHTTPSCertificateRenewal` 會回到 `false`，`TLSValidUntil` 更新為未來日期。
- 用 `openssl s_client` 檢查憑證 SAN，確認只包含預期 wildcard，而不是每個服務 hostname：

```bash
echo | openssl s_client -connect app.example.com:443 \
  -servername app.example.com 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```

- 新增一個被 wildcard 覆蓋的測試 route：DNS 應立即可解析、公開 TLS 應使用既有 wildcard 憑證，且不需要重簽憑證。
- 對數個代表性網站執行正常驗證，確認不是臨時 ACME challenge certificate：

```bash
for host in cosmos.example.com app.example.com blog.example.net; do
  echo "== $host =="
  echo | openssl s_client -connect "$host:443" -servername "$host" \
    -verify_return_error 2>&1 \
    | grep -E 'subject=|issuer=|Verify return code'
  curl -fsSI "https://$host" | head -n 1
done
```

- 重新檢查已搬走的 root domain，確認它仍由新平台提供，不再進入 Cosmos 憑證清單。

## 下次先查

1. 用沒有 `-k` 的 `curl -Iv` 或 `openssl s_client` 確認是真正的 TLS 問題。
2. 搜 Cosmos log 的 `LETSENCRYPT_OBTAIN`，直接看第一個失敗 hostname。
3. 對照該 hostname 的 DNS、Cosmos route、`TLSKeyHostsCached` 與 `OverrideWildcardDomains`。
4. 移除已遷移服務的殘留設定，再做一次強制續期。
5. 要避免未來 CT 暴露單一服務名時，確認 DNS-01 已簽出所有需要層級的 wildcard、DDNS 正在更新它們，並檢查有 MX/TXT 的 hostname 是否仍需獨立 A/AAAA record。
