---
title: Android PWA 返回鍵直接關閉 browser
description: 當單頁 PWA 沒有同步 app 畫面到瀏覽器 history 時，Android 返回鍵會跳過 app 內導覽並直接離開。
date: 2026-07-18
tags:
  - pwa
  - android
  - history-api
  - svelte
status: fixed
system: web-pwa
severity: medium
aliases:
  - popstate android back button
  - PWA back closes browser
---

## 快速結論

Android 的系統返回鍵只會走瀏覽器 history。PWA 若用 local state 切換內容庫、編輯器與 Sheet，卻沒有 `pushState()`，它會直接離開 browser。將每個可返回的 app state 寫入 history，並以 `popstate` 還原畫面，讓返回順序先留在 app 內。

## 症狀

- 從內容庫進入編輯器或設定後，按 Android 系統返回鍵直接關閉 PWA／browser。
- 預覽、發布或新增貼文 Sheet 沒有可預期的返回層級。

## 影響範圍

- Service：client-side PWA。
- Environment：Android browser 與安裝式 PWA。
- 使用者影響：編輯流程被意外中斷；若 autosave 尚未完成，可能增加資料遺失風險。
- 資料風險：無遠端資料風險，但未完成的 local state 有風險。

## 排查

檢查 app 是否只用 framework state 切換畫面，而沒有操作 History API：

```ts
screen = "editor"; // 只有這一行時，Android back 沒有 app history 可走
```

再確認 `popstate` 是否存在，以及它是否先關閉 overlay，再還原內容庫、編輯器或設定頁。

## 根因

PWA 的 router 沒有管理這些畫面，內容庫、編輯器、設定與 Sheet 全由 component local state 控制。瀏覽器 history 因此只有初始頁；Android back 觸發原生離開行為，而不是 app 內返回。

## 修正

將 app state 定義為可序列化的 history payload。進入 editor、settings 或開啟 Sheet 時 `pushState()`；收到 `popstate` 時先儲存 active draft、關閉所有 overlay，再以 state 還原畫面與 active record。

```ts
type AppHistory = {
  goodPosse: true;
  screen: "library" | "editor" | "settings";
  activeId?: string;
  overlay?: "new" | "preview" | "publish";
};

history.pushState({ goodPosse: true, screen, activeId: active?.id, overlay }, "", location.href);

addEventListener("popstate", (event) => {
  const state = event.state as AppHistory | null;
  if (!state?.goodPosse) return;
  saveActiveDraft();
  closeAllOverlays();
  restoreScreen(state);
});
```

將 toolbar 與 navbar 的畫面切換收斂到同一個 navigation helper；不要直接在 template 寫入 `screen = ...`，否則會遺漏 history entry。

## 驗證

- `npm run check` 通過。
- `npm run test` 通過。
- `npm run build` 通過。
- Android 手動驗證順序：Sheet → editor 或 settings → library；只有停在 library 時才交回 browser。

## 下次先查

Android PWA 的返回鍵跳出 app 時，先檢查該畫面切換有沒有 `history.pushState()`，以及 `popstate` 是否能用 record ID 還原畫面。
