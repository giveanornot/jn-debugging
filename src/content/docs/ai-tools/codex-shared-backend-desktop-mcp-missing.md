---
title: Codex 共用後端缺少封存等 Desktop MCP 工具
description: Desktop 有工具但共用 app-server 的聊天看不到時，分查插件與內層 MCP 啟用狀態、IPC 環境及指定 thread 的工具清單。
date: 2026-11-13
tags:
  - codex
  - mcp
  - linux
  - remote
status: fixed
system: codex
severity: medium
aliases:
  - set_thread_archived missing
  - codex_app runtimeStatus disabled
  - CODEX_APP_TOOLS_PIPE_PATH
  - Desktop 工具橋接
---

## 快速結論

Codex Desktop 自己有封存工具，不代表外接的共用 app-server 已取得它。本次共用後端的 `codex_app` MCP 明確回報 `disabled`，而 Desktop 的官方橋接能列出 55 個工具，包含 `set_thread_archived`。

修正在標準 MCP 設定新增獨立的 `codex_desktop` 連線，用小型啟動器找出當次 Desktop IPC，再執行已安裝的官方 MCP 程式。熱重載後，目前聊天能看見並呼叫桌面工具。整機冷開機與不同版本的相容性仍需另驗。

## 症狀

- 聊天結束流程找不到 `set_thread_archived`，其他聊天卻可能有。
- 插件設定顯示 `codex-app-tools@openai-bundled` 已啟用。
- 執行聊天的共用後端與 Desktop 自己的 app-server 是不同程序。
- Desktop 原生 IPC 實測正常，共用後端工具清單卻是空的。

## 影響範圍

實測為 Linux 上的 Codex Desktop runtime `26.1029.61003` 與共用 app-server `0.160.1`。桌面安裝位置、插件結構與 IPC 環境變數應依實際版本核對，不是跨平台通用入口。

這次未刪除聊天、改動 writer lock 或修改官方插件。原先手機／SSH 共用的 daemon 保持運行。

## 排查

1. 從目前工具清單查完整工具名稱，不只搜尋「archive」。`archive_worktree` 封存的是工作樹，不能替代聊天封存。
2. 以 shell 祖先程序確認聊天實際由哪個 app-server 執行，再核對該程序的指定參數與環境；不要印出完整環境或命令列。
3. 對共用後端執行 `mcpServerStatus/list`，指定目前 `threadId`。本次得到：

   ```json
   {"name":"codex_app","runtimeStatus":"disabled","tools":{},"toolsError":null}
   ```

4. 分開查看外層插件與插件內層 MCP。外層 `enabled=true`，但已安裝 `.mcp.json` 的 `mcpServers.codex_app.enabled=false`。
5. 比對 Desktop 自己的 app-server。它帶有內層啟用覆寫與 `CODEX_APP_TOOLS_PIPE_PATH`；共用後端兩者都沒有。
6. 在隔離程序使用 Desktop 的當次 IPC 啟動官方 MCP，只做 `initialize`／`tools/list`。本次列出 55 工具，證明 IPC 和工具提供端正常。測完結束自己的探測程序。

協定與初始化順序見 [Codex App Server 文件](https://learn.chatgpt.com/docs/app-server)。schema 應由實際 CLI 版本產生：

```bash
codex app-server generate-json-schema --experimental --out /tmp/codex-schema
```

## 根因

自訂共用後端的啟動整合沒有承接 Desktop 的內層 MCP 啟用設定與原生 IPC。外層插件已啟用，仍不足以讓該後端初始化桌面工具。

本次有指定 thread 的 `disabled` 狀態、程序參數與環境對照、官方橋接隔離測試三項證據；不是從動態工具資料表為空推論。

## 修正

修改層級是使用者 MCP 設定與桌面啟動入口，沿用已安裝官方程式，未修改 bundle。

[可攜啟動器](/scripts/codex-desktop-tools-bridge.py) 每次啟動會：

- 僅接受同一使用者、指定 Desktop app-server 執行檔提供的 IPC。
- 確認路徑為同使用者擁有的 Unix socket。
- 多個程序若共用同一 socket 則去重；不同 socket 同時存在時拒絕歧義。
- 設定當次 `CODEX_APP_TOOLS_PIPE_PATH`，執行已安裝官方 `launch_codex_app_tools_mcp` 與 `server.mjs`。

先核對腳本的 `RESOURCES` 與安裝位置，保存到固定位置。MCP 設定範例如下，絕對路徑需替換：

```toml
[mcp_servers.codex_desktop]
command = "/usr/bin/python3"
args = ["/absolute/path/to/codex-desktop-tools-bridge.py"]
enabled = true
startup_timeout_sec = 10
tool_timeout_sec = 3600
omit_tools_from = ["deferred"]
```

工具核准政策須一併從當次官方 `.mcp.json` 的 `default_tools_approval_mode` 與 `tools` 複製，不要使用上面的最小連線範例擅自放寬政策。官方提供的[插件 MCP 政策設定](https://developers.openai.com/plugins/build/plugins)區分啟用與工具核准；插件政策覆寫不包含任意 transport 設定。

本次嘗試同名 `codex_app` 熱重載時曾收到 `url is not supported for stdio`，改用獨立名稱後成功。該 URL 的注入來源未定位，不能把這個觀察泛化為所有安裝都禁止同名。

設定完成後，透過既有 app-server 的 `config/mcpServer/reload` 熱重載，並在 Desktop 啟動入口安排：

```bash
python3 /absolute/path/to/codex-desktop-tools-bridge.py --refresh
```

`--refresh` 等待原生 IPC 後呼叫重載 API，使用 Python `websockets` 套件；一般 MCP 啟動只用標準函式庫。這一步讓新的 Desktop socket 在啟動後重新接入共用後端，不將某次暫時 socket 寫入長期設定。

回復時還原備份的 MCP 設定與啟動入口，再呼叫重載 API。不要刪聊天或鎖檔。

## 驗證

- 啟動入口 `bash -n` 通過。
- 5 個連線選擇測試通過：同 socket 去重、歧義拒絕、其他執行檔拒絕、失效／非 socket 拒絕、其他使用者拒絕。
- 指定目前 thread 的狀態為 `codex_desktop connected`，列出 55 工具且含封存工具。
- 模型當輪能看見工具，實際讀取呼叫成功。
- 對原已封存聊天做冪等 `archived:true`，介面成功且封存旗標維持 1。這不是完整的未封存→封存狀態切換測試。
- 原 MCP 工具數維持、共用 daemon PID 未變；未將單純程序存活當成跨裝置驗收。
- 真實 Desktop 重開與整機冷開機，在初次修復驗證時仍未完成。

另有一個容易混淆的測試：對仍在進行、原本未封存的聊天呼叫 `archived:false`，回報 `already has an active writer`；直接呼叫同一共用後端的 `thread/unarchive` 也得到相同錯誤。這個解除封存案例不能直接當成橋接連錯後端，也不能解釋過往所有封存逾時。

## 下次先查

1. 先分清楚「工具缺席」、「工具呼叫失敗」與「實際狀態沒有改變」。
2. 查目前 thread 的 MCP runtime 狀態、程序覆寫與原生 IPC。
3. 用隔離官方橋接確認提供端，再決定修啟動整合或查工具本身。
4. 重開 Desktop 後核對新 socket、重新載入工具及實際呼叫；整機冷開機另驗。
5. 遇到 writer conflict 時再依 [Remote／SSH writer lock 排查](/ai-tools/codex-remote-ssh-active-writer/)定位持有者，不先刪鎖或重啟共用後端。
