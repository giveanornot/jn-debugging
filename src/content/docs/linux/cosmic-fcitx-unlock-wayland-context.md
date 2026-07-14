---
title: COSMIC unlock 後 Fcitx5 卡在 keyboard-us
description: COSMIC lock/unlock can leave a focused Wayland input context stuck so Fcitx5 SetCurrentIM returns success but the current input method stays keyboard-us.
date: 2026-07-14
tags:
  - linux
  - cosmic
  - wayland
  - fcitx
  - rime
  - input-method
status: fixed
system: desktop
severity: medium
aliases:
  - cosmic fcitx unlock
  - fcitx SetCurrentIM keyboard-us
  - wayland_v2 input context
  - rime cannot switch after unlock
---

## 快速結論

COSMIC lock/unlock 後，如果 Fcitx5 還活著但無法從 `keyboard-us` 切回 Rime，不要先改 profile 順序或移除 keyboard layout。

先確認 Fcitx5 controller 是否卡住：`SetCurrentIM(rime)` 回成功，但 `CurrentInputMethod` 仍是 `keyboard-us`。若 `DebugInfo` 顯示 focused `wayland_v2` input context 的 `program:` 是空白，通常要乾淨重建 Fcitx5 process 才會清掉這個壞 context。

## 症狀

- 鎖定再解鎖桌面後，繁中輸入法不可用。
- Fcitx5 tray 還在，服務也還活著。
- `fcitx5-remote -s rime` exit code 是 `0`，但目前輸入法仍是 `keyboard-us`。
- 只用 tray 或快捷鍵手動切換也無法切回 Rime。

最小現象：

```bash
fcitx5-remote -s rime
echo $?
fcitx5-remote
fcitx5-remote -n
```

```text
0
2
keyboard-us
```

## 影響範圍

- 系統：Linux desktop on COSMIC Wayland
- 輸入法：Fcitx5 + Rime
- 影響：桌面解鎖後中文輸入卡住，只剩英文鍵盤
- 資料風險：低；風險主要是錯誤 workaround 會污染 Fcitx profile 或反覆重啟輸入法

## 排查

先確認不是 profile 被改壞。profile 應該同時保留 keyboard layout 與 Rime：

```bash
sed -n '1,160p' ~/.config/fcitx5/profile
sed -n '1,160p' ~/.config/fcitx5/config
```

穩定基線：

```text
DefaultIM=rime
Groups/0/Items/0 = keyboard-us
Groups/0/Items/1 = rime
ShareInputState=No
```

接著確認 controller 看到的 current IM 與 group：

```bash
fcitx5-remote
fcitx5-remote -n
fcitx5-remote -q
```

如果 CLI switch 回成功但 current IM 不變，用 D-Bus controller 直接查：

```bash
dbus-send --session \
  --dest=org.fcitx.Fcitx5 \
  --print-reply \
  /controller \
  org.fcitx.Fcitx.Controller1.SetCurrentIM \
  string:rime

dbus-send --session \
  --dest=org.fcitx.Fcitx5 \
  --print-reply \
  /controller \
  org.fcitx.Fcitx.Controller1.CurrentInputMethod
```

如果仍回 `keyboard-us`，看 input context：

```bash
dbus-send --session \
  --dest=org.fcitx.Fcitx5 \
  --print-reply \
  /controller \
  org.fcitx.Fcitx.Controller1.DebugInfo
```

關鍵線索：

```text
Group [wayland:] has 3 InputContext(s)
  IC [...] program: frontend:wayland_v2 ... focus:1
```

`program:` 空白而且 `focus:1` 時，表示 focus 落在一個不正常的 Wayland input context。這種狀態下 Fcitx controller call 可以成功返回，但實際 current IM 不會變。

## 根因

COSMIC unlock 後留下了一個 focused `wayland_v2` input context。這個 context 沒有正常的 program name，並且吃住目前 focus。

Fcitx5 process、Rime addon、D-Bus controller 都還活著，所以一般健康檢查會誤判為正常。真正壞掉的是 focused input context 的狀態：切換命令回成功，但 current IM 仍停在 `keyboard-us`。

這和「Fcitx profile 被重設成只剩 keyboard-us」不同。profile 正常時，改 `ShareInputState`、把 Rime 排到第一個、移除 keyboard layout，都不是根本修法，還可能讓 tray/manual switch 更壞。

## 修正

短期 workaround 是 unlock 後先嘗試切回 Rime；若切不動，才乾淨重建 Fcitx5 process。

不要用無條件 watchdog restart。只在 unlock 事件後，而且只有 force Rime 失敗時才 restart。

核心流程：

```bash
force_rime() {
  for _ in 1 2 3 4 5; do
    fcitx5-remote -o >/dev/null 2>&1 || true
    fcitx5-remote -s rime >/dev/null 2>&1 || true
    sleep 0.5

    if [ "$(fcitx5-remote -n 2>/dev/null || true)" = "rime" ]; then
      return 0
    fi
  done

  return 1
}

restart_fcitx_cleanly() {
  systemctl --user stop fcitx5.service >/dev/null 2>&1 || true
  sleep 0.8
  pkill -x fcitx5 >/dev/null 2>&1 || true
  sleep 0.3
  systemctl --user start fcitx5.service >/dev/null 2>&1 || true
  sleep 1.5
}

force_rime || {
  restart_fcitx_cleanly
  force_rime
}
```

Unlock detection can use COSMIC greeter logs:

```bash
journalctl --system -f -n0 -o cat -t cosmic-greeter
```

Trigger on lines such as:

```text
pam_unix(login:account)
session opened
```

Keep any periodic Fcitx watchdog disabled if it restarts Fcitx based on weak signals such as empty `fcitx5-remote -n` output. With no focused text field, empty output can be normal.

## 驗證

Normal path should not restart Fcitx:

```bash
fcitx5-remote
fcitx5-remote -n
systemctl --user is-active fcitx5-unlock.service
systemctl --user is-active fcitx5.service
```

Expected:

```text
2
rime
active
active
```

Test the unlock watcher with a synthetic greeter log:

```bash
fcitx5-remote -s keyboard-us
logger -t cosmic-greeter 'pam_unix(login:account): fcitx unlock test'
sleep 3
fcitx5-remote -n
```

Expected:

```text
rime
```

When reproducing the real failure, check that the fallback restart happened only after force Rime failed. The useful log shape is:

```text
recovery triggered by cosmic-greeter
failed to activate rime; current=keyboard-us
restarting fcitx5 cleanly
rime active
```

## 下次先查

1. Confirm profile was not modified: `~/.config/fcitx5/profile`.
2. Run `fcitx5-remote -s rime && fcitx5-remote -n`.
3. If it stays `keyboard-us`, inspect `org.fcitx.Fcitx.Controller1.DebugInfo`.
4. If focused `wayland_v2` has blank `program:`, clean restart Fcitx5.
5. Avoid profile-order hacks, terminal-focus hacks, and ydotool unless there is new evidence.
