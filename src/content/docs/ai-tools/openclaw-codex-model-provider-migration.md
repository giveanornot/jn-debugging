---
title: OpenClaw 升級後 Codex 模型顯示 unavailable
description: OpenClaw 升級後，因 Node runtime 或舊 openai-codex provider 殘留而無法使用 Codex 模型時的排查與修復。
date: 2026-07-31
tags:
  - openclaw
  - codex
  - openai
  - nodejs
status: fixed
system: openclaw
severity: medium
aliases:
  - Configured model is unavailable from the provider
  - Unknown model openai-codex
  - OpenClaw Codex model unavailable
---

## 快速結論

新版 OpenClaw 將舊的 `openai-codex` provider 整合為 `openai`，但舊的模型設定或 agent `models.json` custom provider 可能仍把模型解析回 legacy provider。先讓 gateway 使用受支援的 Node，清掉 legacy provider registration，再將 primary 設為 `openai/gpt-5.6-luna`。

不要只看 OAuth 是否有效。`openclaw models status` 必須同時顯示 `provider: openai`、`runtime: codex` 與 `status: usable`。

## 症狀

- `openclaw update` 看似已下載新版，但 CLI 或 gateway 仍執行舊版本。
- 新版啟動時要求較新的 Node runtime。
- Discord 或其他 channel 回覆：

```text
The configured model is unavailable from the provider
```

- gateway log 可能更明確指出：

```text
Unknown model: openai-codex/gpt-5.6-luna
"openai-codex" is a legacy provider ID.
```

## 影響範圍

- 服務：OpenClaw gateway
- 影響：對話無法產生回覆，即使 ChatGPT/Codex OAuth profile 仍有效
- 資料風險：低；修復主要改 runtime、provider registration 與 model reference

## 排查

先分開確認 package、Node 與 service 實際使用的 runtime：

```bash
openclaw --version
node --version
openclaw update status --json
systemctl --user status openclaw-gateway.service
```

新版若拒絕目前 Node，先依 launcher 提示安裝受支援的版本。確認 gateway 的 `ExecStart` 實際指向該 Node，而不是只在 interactive shell 的 PATH 變更。

接著檢查模型解析與 OAuth route：

```bash
openclaw models list --all --provider openai --plain
openclaw models status --json
openclaw config validate
```

正常的 route 應包含：

```json
{
  "provider": "openai",
  "runtime": "codex",
  "authProvider": "openai",
  "status": "usable"
}
```

若 config 已寫 `openai/...`，但 `resolvedDefault` 又變成 `openai-codex/...`，檢查 agent-local custom model registry 是否仍有 legacy provider：

```bash
jq '.providers | keys' ~/.openclaw/agents/main/agent/models.json
jq -r '.agents.defaults.model.primary' ~/.openclaw/openclaw.json
```

## 根因

這類問題常由兩層舊狀態疊加造成：

1. package 升級後提高 Node 最低版本，舊 systemd service 仍固定呼叫舊 Node，因此無法執行新版 host。
2. 舊版留下的 `openai-codex` custom provider 或 model reference 會覆寫新版的 canonical `openai` provider。OAuth profile 即使已被 migration 成 `openai`，模型仍會被送往被淘汰的 provider ID。

## 修正

先把 gateway 指到受支援的 Node。可用 user-local Node，避免直接替換系統 Node；概念如下：

```ini
# ~/.config/systemd/user/openclaw-gateway.service.d/node-runtime.conf
[Service]
ExecStart=
ExecStart=/path/to/node /path/to/openclaw/dist/index.js gateway --port 18789
```

修改後重新載入 systemd：

```bash
systemctl --user daemon-reload
```

再先備份 custom model registry，移除只用於舊 Codex integration 的 `openai-codex` provider entry；不要刪除其他 provider：

```bash
cp ~/.openclaw/agents/main/agent/models.json \
  ~/.openclaw/agents/main/agent/models.json.pre-openai-migration.bak
```

最後設定 canonical model ref，並讓 doctor 處理其餘可自動修復的 legacy config：

```bash
openclaw doctor --fix
openclaw config set agents.defaults.model.primary openai/gpt-5.6-luna
openclaw config validate
systemctl --user restart openclaw-gateway.service
```

若 `config set` 又寫回 `openai-codex/...`，不要重複重試；回到 custom model registry，確認 legacy provider entry 已移除後再設定一次。

## 驗證

```bash
systemctl --user is-active openclaw-gateway.service
openclaw models status --json
journalctl --user-unit=openclaw-gateway.service -n 80 --no-pager
```

應同時確認：

- service 是 `active`；
- `resolvedDefault` 是 `openai/gpt-5.6-luna`；
- runtime route 為 `openai` + `codex` + `usable`；
- gateway log 有 `agent model: openai/gpt-5.6-luna` 與 `gateway ready`；
- 新 channel 訊息不再出現 `Unknown model: openai-codex/...`。

## 下次先查

遇到「OAuth 正常但 model unavailable」時，先看這三件事：

```bash
node --version
openclaw models status --json
jq -r '.agents.defaults.model.primary' ~/.openclaw/openclaw.json
```

若第三項是 canonical `openai/...`，但 models status 仍解析成 `openai-codex/...`，優先檢查 agent-local `models.json` 的 legacy provider，而不是重新登入 OAuth。
