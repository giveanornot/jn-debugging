---
title: Framework7 Svelte 白畫面與本機草稿無法開啟
description: Framework7 Svelte apps can fail during startup, local draft persistence, or Sheet interaction after HMR when adapter, reactive-state, and component event contracts are mixed.
date: 2026-07-18
tags:
  - framework7
  - svelte
  - indexeddb
  - progressive-web-app
  - frontend
  - hot-module-replacement
status: fixed
system: web-app
severity: medium
aliases:
  - Framework7 Svelte app.Framework7 is not a constructor
  - Framework7 Svelte blank screen
  - Svelte DataCloneError IndexedDB
  - Svelte structuredClone proxy error
  - Framework7 Sheet closeByBackdropClick
  - Framework7 Svelte Sheet HMR backdrop error
---

## 快速結論

Framework7 Svelte 的元件套件不會自行提供 Framework7 核心。若只匯入元件，`<App>` 初始化時會拋出 `app.Framework7 is not a constructor`，頁面看起來會是白畫面。先註冊 adapter，再處理資料層。

接著若把 Svelte 5 `$state` proxy 直接傳給 `indexedDB.put()` 或 `structuredClone()`，編輯或自動儲存會再出現 `DataCloneError`。資料進入 IndexedDB 前要轉成 plain object；不要直接 clone reactive proxy。

若只有在熱更新後點 Sheet、關閉按鈕或 backdrop 才失效，先移除 `backdrop` prop，改用明確關閉按鈕，並將 Framework7 `<Button>` 的 handler 寫為 `onClick`。這避免舊 Sheet instance 的 backdrop handler 在文件層處理點擊時讀到不存在的設定。

## 症狀

- 開啟本機或 deployed PWA 後只看到白畫面。
- 開發 console 出現：

```text
TypeError: app.Framework7 is not a constructor
```

- 首頁能顯示後，點既有草稿或 autosave 又失敗：

```text
DataCloneError: Failed to execute 'put' on 'IDBObjectStore'
DataCloneError: Failed to execute 'structuredClone'
```

- 開發模式完成 HMR 後，點 Sheet 內任一控制項或 backdrop 出現：

```text
TypeError: Cannot read properties of undefined (reading 'closeByBackdropClick')
```

  Sheet 可能不再開啟或關閉；就算改動本身已正確編譯，互動仍被 document-level click handler 中斷。

- Framework7 的 navbar slot、list 或 icon font 看似有載入，但標題消失、文字重疊，或顯示 icon 名稱。

## 影響範圍

- Service：使用 Framework7 9、Svelte 5 與 IndexedDB 的 local-first web app
- 觸發條件：只安裝／匯入 `framework7-svelte`、將 reactive state 當作可 structured-clone 的普通物件，或在 Sheet 有 `backdrop` prop 時經過 HMR
- 使用者影響：app 無法啟動，或讀取後無法開啟、修改、儲存既有草稿
- 資料風險：低；錯誤發生在寫入前，現有 IndexedDB 資料通常仍在

## 排查

先看 browser console 的第一個 initialization error。若 stack trace 指到 `framework7-svelte/shared/f7.js` 的 `new app.Framework7(...)`，確認 entry point 是否註冊 Framework7 Svelte adapter。

再測兩個資料操作：

1. 開啟既有草稿。
2. 修改文字，等待 autosave。

如果其中一個操作拋 `DataCloneError`，檢查傳入 `structuredClone()`、`IDBObjectStore.put()` 或訊息傳遞 API 的值是否來自 `$state`。編譯和型別檢查不會抓到這個 runtime 問題。

最後用實際 browser 畫面檢查 component contract：`Navbar` 是否使用它支援的 title／slot props、`Page` 是否只有一層 `.page-content`，以及圖示字型是否真的有被載入。不要只靠 production build 成功判斷 UI 正常。

若錯誤包含 `closeByBackdropClick`，在 fresh reload 和 HMR 後都各測一次 Sheet 開啟、關閉與內部 action。比較有／無 `backdrop` 的 Sheet，並確認 `<Button>` 使用 Framework7 的 `onClick` prop，而不是依賴 pass-through HTML event attribute。

## 根因

這次有三個彼此獨立的層次：

1. `framework7-svelte` 是 adapter；它會在 `<App>` mount 時讀取已註冊的 Framework7 constructor。沒有 `Framework7.use(Framework7Svelte)` 時，constructor 是空值。
2. Svelte 5 reactive state 是 proxy。它適合 template reactive tracking，但不是所有 browser structured-clone API 都能序列化的普通資料。
3. Framework7 component 的 API 與直覺 HTML nesting 不完全相同。把 `Navbar` slot 再包一層 `NavLeft`／`NavRight`，或讓 `Page` 自動與手動各生成一層 `.page-content`，會產生空白 header、錯位與文字重疊。`f7` icon prop 也需要對應 icon font；沒有資產時會直接顯示 glyph 名稱。
4. HMR 會替換 Svelte component tree，但 Framework7 的 Sheet/backdrop click handling 仍可能保留舊 instance 的狀態。當點擊事件進入 framework handler 時，已失效的 Sheet 設定是 `undefined`，讀取 `closeByBackdropClick` 就中斷後續互動。

## 修正

在 Svelte mount 前註冊 adapter，並從同一個 Framework7 bundle 匯入核心：

```ts
import Framework7 from "framework7/bundle";
import Framework7Svelte from "framework7-svelte";

Framework7.use(Framework7Svelte);
```

寫入 local store 前把 reactive value 轉成 plain data。內容是純 JSON 資料時，可採最小明確轉換：

```ts
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

await store.savePost(plain(activePost));
await store.saveSite(plain(siteProfile));
```

若資料含有 `Blob`、`Date`、`Map` 等非 JSON 型別，改用明確 serializer 或只 snapshot 可序列化欄位；不要把 proxy 直接餵給 `structuredClone()`。

元件層採用 Framework7 支援的 props，避免重複容器：

```svelte
<Page pageContent={false}>
  <Navbar title="貼文">
    {#snippet right()}<Button>新增</Button>{/snippet}
  </Navbar>
  <div class="page-content">...</div>
</Page>
```

清單、設定欄位與 icon 若無法與既有 theme 正確搭配，使用小型自訂 row／inline SVG；保留 Framework7 做 app shell、page、navbar、toolbar 與 sheet 即可。

對需要穩定關閉行為的 Sheet，不使用 backdrop close，改為受 state 控制的明確按鈕；Framework7 元件的 click callback 則使用它公開的 `onClick` prop：

```svelte
<Sheet opened={publishOpen} onSheetClosed={() => publishOpen = false}>
  <header>
    <Button small onClick={() => publishOpen = false}>關閉</Button>
  </header>
</Sheet>
```

`<Button onclick={...}>` 可能只是透傳成 DOM attribute，容易與 Framework7 對 anchor click 的處理順序互相干擾；`onClick` 才是元件層 callback。

## 驗證

- `npm run check` 通過。
- `npm run build` 通過。
- Browser 開啟首頁後可見 navbar title、內容庫、底部導覽與縮圖。
- 點既有草稿能進入 editor；編輯後 autosave 不再出現 `DataCloneError`。
- 設定頁欄位、建立貼文 sheet 以及取消操作可正常顯示與互動。
- fresh reload 與一次 HMR 後，Sheet 都可開啟、關閉，內部 action 不再出現 `closeByBackdropClick`。
- Browser console 沒有 `app.Framework7 is not a constructor`、`DataCloneError` 或未載入 icon font 造成的文字 glyph。

## 下次先查

1. 白畫面先看第一個 console error；命中 `app.Framework7` 就查 adapter 註冊。
2. 首頁可見但開草稿／autosave 失敗，就搜尋所有 `structuredClone`、`IDBObjectStore.put` 與 `$state` 交界。
3. UI 有空白 header、重疊或 icon 字串時，讀元件 source／型別確認 slot contract，並用 browser 截圖驗證實際 layout。
4. 只有 Sheet 點擊失效時，先搜尋 `backdrop` 與 `<Button onclick`；移除 backdrop close，改為 `onClick` 和明確關閉按鈕後再測 HMR。
