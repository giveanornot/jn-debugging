---
title: Arch Linux ELAN 指紋辨識在 COSMIC 鎖定畫面失效
description: ELAN 04f3:0c4b 已註冊卻無法解鎖時，依序確認專用驅動、實際比對結果，以及 COSMIC 與 Bitwarden 各自使用的 PAM service。
date: 2026-08-12
tags:
  - arch-linux
  - fingerprint
  - fprintd
  - cosmic
  - pam
  - bitwarden
  - polkit
status: fixed
system: Linux desktop
severity: medium
aliases:
  - ELAN 04f3:0c4b fprintd
  - COSMIC fingerprint unlock
  - pam_fprintd COSMIC lock screen
  - COSMIC fingerprint timeout password fallback
  - pam_fprintd timeout=-1
  - Bitwarden system authentication fingerprint
---

## 快速結論

`fprintd-enroll` 成功不代表指紋能解鎖。先以 `fprintd-verify` 得到 `verify-match`，再從 journal 找出 COSMIC 鎖定畫面真正呼叫的 PAM service。本案例的運行中 COSMIC locker 使用 `login`，不是預期中的 `cosmic-greeter`；將 `pam_fprintd.so` 加到錯誤檔案不會生效。

ELAN USB ID `04f3:0c4b` 在通用 `libfprint` 驅動出現 protocol error 時，需使用相容的 TOD library 與 Lenovo ELAN driver。COSMIC locker 和 Bitwarden system authentication 是兩條不同的 PAM 鏈：前者用 `login`，後者經由 `polkit-1`。兩條都要保留密碼 fallback；不要修改 `sudo` 或共用的 `system-auth`。

若 COSMIC 在閒置鎖定很久後自動從指紋畫面切到密碼，這通常是 `pam_fprintd` 預設的 30 秒驗證 timeout，不是模板或 reader 失效。把 `login` 的模組參數設為 `timeout=-1`，即可持續等待指紋，並在達到 `max-tries`（預設三次）後才進入密碼 fallback。

## 症狀

- `lsusb` 看得到 `04f3:0c4b ELAN:Fingerprint`，`fprintd-list` 也顯示已註冊手指。
- 鎖定 COSMIC 後只接受密碼，掃指紋沒有反應。
- Bitwarden Linux 的 system authentication 開關自動取消，或按鈕只回傳 authentication failed。

常見關鍵訊息：

```text
Device reported an error during enroll: The driver encountered a protocol error with the device.
Verify result: verify-no-match (done)
pam_unix(login:account): setuid failed: Operation not permitted
```

## 影響範圍

- 系統：Arch Linux、fprintd、COSMIC Wayland、SDDM。
- 硬體：ELAN `04f3:0c4b` USB 指紋讀取器。
- 影響：登入、鎖定畫面與使用系統驗證的密碼管理器無法用指紋；密碼登入仍應可用。
- 資料風險：無；PAM 設定錯誤可能造成登入流程卡住，先保留原檔備份。

## 排查

先確認裝置、指紋模板與真正的比對結果，不要只看錄入成功：

```bash
lsusb -d 04f3:0c4b
fprintd-list "$USER"
fprintd-verify -f right-index-finger "$USER"
```

只有以下結果才代表模板可用：

```text
Verify result: verify-match (done)
```

若得到 `verify-no-match`，刪除舊模板並重新錄入；錄入時以同一根手指做短按、抬起，稍微改變角度：

```bash
sudo fprintd-delete "$USER" right-index-finger
sudo fprintd-enroll -f right-index-finger "$USER"
fprintd-verify -f right-index-finger "$USER"
```

若通用驅動發生 protocol error，先確認正在使用的 library：

```bash
pacman -Q fprintd libfprint libfprint-tod libfprint-2-tod1-elan 2>/dev/null
journalctl -u fprintd.service -b --no-pager -n 80
```

對此 ELAN ID，可使用 TOD 版 `libfprint` 與 Lenovo ELAN driver；它們通常替換通用 `libfprint`。安裝前檢查 AUR PKGBUILD、保留套件交易紀錄，並在升級後重測指紋。

最後不要猜 COSMIC 使用哪一個 PAM service。鎖定並嘗試解鎖一次後，查 journal：

```bash
journalctl -b --no-pager | rg 'pam_unix\(([^:]+):account\)|cosmic-greeter|fprint'
```

本案例顯示：

```text
pam_unix(login:account): ...
```

因此 locker 使用的是 `/etc/pam.d/login`。某些版本的原始碼或發行版文件提到 `cosmic-greeter`，但以正在運行系統的 journal 為準。

## 根因

這是四個獨立問題疊加，而非單一「COSMIC 不支援指紋」：

1. 通用 `libfprint` 對 ELAN `04f3:0c4b` 傳輸協定不相容。
2. 初次錄入的模板雖存在，但實際驗證為 `verify-no-match`。
3. COSMIC lock screen 呼叫 `login` PAM service；把 `pam_fprintd.so` 寫到 `cosmic-greeter` 不會進入該驗證鏈。
4. Bitwarden 的 system authentication 經由 Polkit 呼叫 `/usr/lib/pam.d/polkit-1`，而後者預設只 include `system-auth`；即使 COSMIC 的 `login` 已加入指紋，Bitwarden 仍只會走密碼。

Bitwarden 另有包裝層問題：Linux system authentication 需要 `/usr/share/polkit-1/actions/com.bitwarden.Bitwarden.policy`。若 app log 顯示 `Failed to set up polkit policy`，先安裝 Bitwarden 內建的 policy 後完整重啟桌面程式，再於設定中首次建立指紋解鎖金鑰。

## 修正

先備份實際被使用的 PAM service：

```bash
sudo install -D -o root -g root -m 0644 /etc/pam.d/login /etc/pam.d/login.pre-fingerprint
```

在 `/etc/pam.d/login` 的 `pam_nologin.so` 之後、原本的登入 stack 之前加入：

```text
auth       sufficient pam_fprintd.so
```

最小形狀如下：

```text
auth       required   pam_securetty.so
auth       requisite  pam_nologin.so
auth       sufficient pam_fprintd.so
auth       include    system-local-login
```

`sufficient` 讓成功的指紋完成驗證；掃描失敗或逾時則繼續進入既有密碼路徑。若 SDDM 與 COSMIC locker 使用不同 service，對 SDDM 的 PAM 檔也加入同一行，但不要修改 `sudo` 或全域 Polkit 規則。

### 長時間鎖定後仍優先指紋

`pam_fprintd` 的預設 `timeout` 是 30 秒。若使用者希望即使裝置已鎖定很久，仍持續以指紋解鎖，而不是因為時間經過就直接顯示密碼，將 COSMIC locker 的 `login` 規則改為：

```text
auth       sufficient pam_fprintd.so timeout=-1
```

負值代表指紋模組不以時間結束驗證。模組仍保留預設 `max-tries=3`：連續三次未比對成功後，PAM 會繼續進入 `system-local-login` 的密碼 stack。這個選擇適合偏好「指紋一直可用、掃錯才切密碼」的情境；若需要隨時立刻輸入密碼，保留預設 timeout，或改用較長的正數秒數。

### Bitwarden system authentication

Bitwarden 的 action policy 存在後，備份 distro 提供的 Polkit PAM 檔，再用只影響 `polkit-1` 的 override 加入指紋：

```bash
sudo install -D -o root -g root -m 0644 \
  /usr/lib/pam.d/polkit-1 /etc/pam.d/polkit-1.pre-fingerprint
```

`/etc/pam.d/polkit-1`：

```text
auth       sufficient   pam_fprintd.so
auth       include      system-auth
account    include      system-auth
password   include      system-auth
session    include      system-auth
```

這個 override 只讓需要 Polkit 的 desktop app 先嘗試指紋，掃描失敗或逾時仍進入既有系統密碼流程。不要直接改 `/etc/pam.d/system-auth`，否則會擴大到不需要指紋的授權操作。

Polkit 的密碼對話框可能仍會顯示；它只是 fallback。點選 Bitwarden 的 **Unlock with system authentication** 後，先直接掃指紋，不必輸入欄位。避免同時發起多個驗證請求，否則 `fprintd` 可能回報 reader 已被 claim，或暫時為避免過熱而停用。

## 驗證

1. `fprintd-verify` 顯示 `verify-match`。
2. 鎖定 COSMIC，畫面出現後直接掃指紋；不要先輸入密碼。
3. 另測一次密碼登入，確認指紋失敗時仍可回退。
4. 讓系統鎖定超過 30 秒後再解鎖；畫面仍應接受指紋。接著刻意以未註冊手指掃三次，確認才會切到密碼 fallback。
5. 登出至 SDDM，確認 SDDM 的指紋與密碼備援都能使用。
6. 若使用 Bitwarden，先以主密碼解鎖一次，在 Settings 啟用 system authentication，再鎖定 app，點選 **Unlock with system authentication** 並直接掃指紋。
7. Bitwarden log 應出現 `unlockWithBiometrics` 和 `Vault unlocked`；另試一次系統密碼，確認 fallback 完整。

## 下次先查

```bash
fprintd-verify -f right-index-finger "$USER"
journalctl -b --no-pager | rg 'pam_unix\(([^:]+):account\)|polkit-1|fprint'
```

先確認「模板是否 match」與「是哪一個 PAM service 被叫到」。COSMIC locker 查 `login`；Bitwarden 查 `polkit-1`，不要把已驗證的一條 PAM 修正誤套到另一條。
