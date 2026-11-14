[Русский](README.md) · **English**

# Problet

A browser written from scratch on Electron, focused on a customizable interface and convenient work with tabs. Your own bars and buttons, spaces, tab freezing, an ad blocker, a password manager and built-in tools instead of extensions.

## Download

Builds for Linux, Windows and macOS appear on the [Releases](https://github.com/cersat/Problet/releases) page with every code change.

| System | File | How to run |
| --- | --- | --- |
| Linux | `.AppImage` or `.tar.gz` | Make the AppImage executable (`chmod +x Problet-*.AppImage`) and run it |
| Windows | `.exe` installer or `.zip` | Run the installer |
| macOS | `.dmg` or `.zip` | The app is not signed: on first launch open it through the context menu → “Open” |

You can update right in the browser: Settings → Updates. The check runs on startup and on a schedule (the interval is configurable; while a fresh version is still being built, you can check more often), and the settings show the changelog of the latest version. The AppImage replaces itself, on Windows the installer is downloaded and launched, on macOS a `.dmg` is downloaded and the installer is opened.

## Interface language

Russian and English. Settings → Language: Auto (as in the system), Русский or English. The interface of the browser itself is translated: settings, menus, dialogs, Problet pages, the SVG editor. The language switches instantly; some of Chromium’s own system labels update after a restart (there is a button for it). The strings are kept in `pages/i18n-en.js` (Russian is the source language in the code, English is looked up in this dictionary); `node tools/smoke.js` checks the switch.

## Features

- **Tabs**: drag and drop, pinning, renaming (right click → “Rename tab”; the name stays until the tab is closed), session restore, site icons (cached), Ctrl+1…9, a list of all tabs (Ctrl+Shift+A) and reopening a closed one (Ctrl+Shift+T). Optionally a second tab with the same address is not opened and the first one is switched to instead.
- **Tab freezing**: tabs that have not been opened for a while are frozen after a chosen time (from a minute to a day), optionally on startup and when switching spaces. Frozen tabs can be unloaded from memory; the tab history is then saved to disk and the tab opens exactly where it was.
- **Incognito mode** (Ctrl+Shift+N, right click on “+”, an item in the link menu): a separate in-memory session. History, passwords, zoom and search queries are not saved, cookies are erased when the last such tab is closed. Downloads from incognito can require confirmation.
- **Bars**: three bars (tabs, tools, bookmarks) and the page window can be arranged in any order; tabs can also go to a side bar. Every button (back, forward, reload, applets, “+”, spaces, window buttons) moves to any bar or is hidden, and the order is changed with arrows. Three flexible spacers push elements to the edges of a bar; on a bar without a spacer, tabs and bookmarks stretch, and the address bar with a spacer shrinks to the text. The tab bar can be stretched with the mouse up to double size; on a tall bar, tabs lie in two rows (or titles wrap onto several lines). The “back” and “forward” arrows are chosen in the theme.
- **Custom buttons**: a button with a name and an icon (a symbol or one drawn in the editor) that opens an address, runs a script on the open page or runs any browser command from the hotkey list. It can be placed on any bar and given a hotkey.
- **Cache**: retention period, separate switches for icons, pages, images, fonts, video and audio and scripts, the cache size (with a refresh and clear button) and your own folder for it (works after a restart).
- **Pages for offline**: right click on a tab → “Save for offline”, Ctrl+Alt+S or “Save all tabs” on `problet://offline`. A page is saved as one file (with its images and styles) and opens from the list without the internet. Pages from private windows are not saved.
- **Page translation**: through Google Translate, into any language from the list (the interface language by default). Turned on by the “Page translation” button (hidden by default, place it in “Bars”), Ctrl+Shift+Y or automatically for every page: Settings → Language. The page text is sent to Google; pages already in the target language are left alone, code, `translate="no"` and input fields are not touched, and text loaded later is translated on its own.
- **Dark theme for a page**: a built-in button and Ctrl+Shift+L invert the colors of the open page; pressing again returns it to normal.
- **Address bar**: suggestions from bookmarks, history and search, a built-in calculator, search engine suggestions (off by default: the typed text is sent to the search engine), the number of suggestions is selectable (5…12). **Search engine prefixes**: “w cats” searches Wikipedia, “yt …” YouTube, “gh …” GitHub; the list of prefixes is edited in the search settings.
- **Spaces**: every tab belongs to a space, and each space shows only its own tabs (or all at once if they are not separated). The spaces applet picks the current one and creates, renames and deletes spaces; it opens as a tab or a popup panel.
- **Character map**: an applet on the toolbar; the character is inserted into the field where the cursor was (on the page or in the address bar).
- **Star and Ctrl+D**: the bookmark is added to the default folder right away (no folder, the last chosen one or a selected folder), and a popup opens where you can change the name, move it to another or a new folder, or delete it. Optionally the star just adds or removes the bookmark without a popup.
- **Bookmark backups**: every day or week (only if the bookmarks changed), how many to keep and in which folder is selectable; restoring takes one button, and the current bookmarks are saved as a backup before that.
- **Broken bookmarks**: checks all addresses — which ones no longer open (no page, no site, file deleted) and which may be temporarily unavailable; delete them one by one or all at once.
- **Browsing history**: retention period (a week, a month, 3 months, half a year, a year or forever), clearing for the last hour, day, week, month or all time, a visit counter — tiles of frequently visited sites on the new tab with the number of visits.
- **Bookmarks and history**: folders with colors (a folder on the bar opens a popup with a list; it can be recolored, deleted, or all its bookmarks opened at once), right click on a bookmark (edit, delete, a custom icon: drawn in the SVG editor and shown instead of the site icon), import and export (JSON and HTML like Chrome and Firefox), history search. Bookmarks can be imported straight from Chrome, Edge, Brave, Vivaldi, Opera and Firefox installed on the computer (Settings, Data).
- **Downloads**: its own list, cancel, show in folder.
- **Local files**: a folder opened as an address is shown by an explorer (`problet://files`): folders and files with clear icons, search, hidden files on request, and a list of drives on Windows. `.svg` and `.png` open in the graphic editor.
- **Graphic editor** (`problet://svgedit`): an editor in the spirit of Scratch’s “Costumes” — shapes, brush, text, fill, gradients, layers, undo. `.svg` opens in vector mode, `.png` in raster mode right away. The “Properties” panel on the right:
  - exact X, Y, width and height of the selection (keeping proportions), rotation by a given angle, opacity;
  - alignment to edges and centers (one shape — to the canvas, several — to the common frame) and equal gaps between shapes;
  - boolean operations on paths: unite, subtract, intersect, exclude;
  - inserting an image from disk (svg, png, jpg, gif, webp) as a new shape;
  - SVG code: show, edit by hand and apply;
  - copying PNG to the clipboard, PNG background (transparent, white, black), rounding coordinates when saving (files get smaller).

  Saves to a file (Ctrl+S), “Save as” (Ctrl+Shift+S), exports to PNG ×1…×8 (Ctrl+Shift+E), copies the code. It is also used to draw custom icons for bookmarks and buttons: if a bookmark has a site icon, drawing starts from it. Based on [scratch-paint](https://github.com/TurboWarp/scratch-paint) (TurboWarp, GPL-3.0); its license is in `pages/svgedit.LICENSE.txt`, and the build is described in `tools/paint/build.sh`.
- **Zoom**: remembered for each site.
- **Screenshot** of the whole page (Ctrl+Shift+S), **page source** (Ctrl+U), **developer tools** (F12).
- **Find in page** (Ctrl+F) with a counter.
- **Print** (Ctrl+P) and **save as PDF** (Ctrl+Alt+P).
- **Problet addons**: its own extension format (`addon.json`) with its own API: scripts on pages, a background, buttons on bars, files, system commands, unrestricted network. An addon asks permission for dangerous actions. They are installed from the [ProbletAddons](https://github.com/cersat/ProbletAddons) catalog, by a link to `addon.json` or from an archive: Settings → Extensions → “Add a Problet addon”. The format and API are described in the catalog’s README.
- **`window.isProblet`**: a site sees `true` when the browser is not disguised as another one.
- **Chrome extensions**: unpacked folders with manifest.json or a link from the Chrome Web Store. Each extension has its own button, which can be moved in “Bars” and opens the extension’s window when pressed. Not all APIs are supported: missing ones are replaced with stubs, so complex extensions may not work fully.
- **Hotkeys**: every shortcut can be reassigned in the settings.
- **Ad and tracker blocker**: lists of domains and paths, hides ad blocks on pages, cuts ads on YouTube, ads are replaced with an “Ad blocked” stub, and you can add your own block list. A separate switch hides cookie consent banners. The blocker itself is off by default.
- **Warning about insecure sites**: going to `http://` can optionally show a warning page first.
- **Privacy**: the Do Not Track header, disguise as Chrome, Problet or Firefox (User-Agent, Sec-CH-UA and `navigator`). The Chrome version is taken from the real engine.
- **Password manager**: an encrypted vault (AES-256-GCM, key from the master password via scrypt), saving and filling through a popup (when the vault is locked it asks for the master password), two-step sign-in (username first, then password) is filled too, export and import to CSV with a master password check.
- **Themes**: dark and light, pastel accents or your own color from a palette, background tint (neutral, warm, cool, deep — pure black for OLED or pure white), high contrast, interface scale from 80 to 150 % (bars and browser windows; pages are scaled separately), a choice of “back” and “forward” arrows. Eight ready-made theme sets (Problet, Midnight, Warm evening, Northern, Forest, Sharp, Paper, Day) and your own sets: the current theme is saved under a name and applied with one click.
- **Default browser**: a button in “Data” (on Linux, for the AppImage it creates a shortcut and assigns it).
- **Service pages**: `problet://settings`, `bookmarks`, `history`, `downloads`, `passwords`, `version`, `spaces`, `files`, `svgedit`, `offline`. A non-existent service page shows a neat 404 error. If you click the version seven times in the card on `problet://version`, the debug menu opens (`problet://version/debug/`): forced update, clearing cookies and site data, resetting settings, removing extensions and addons.

## Good to know

- The disguise changes the headers and what JavaScript sees in the main window of a page. It does not apply inside iframes of other sites, and the engine itself stays Chromium.
- The master password is not stored anywhere. If you forget it, the passwords cannot be recovered.
- The passwords CSV is not encrypted: delete the file after the transfer.
- Passkeys (WebAuthn) are disabled: sites that offer them continue sign-in with a regular password. If a site strictly requires a passkey, you will not be able to sign in with Problet.
- Password filling works only in the main window of a page and only at the same address (scheme, host and port) where the password was saved.

## Building from source

Node.js is required.

```
npm install
npm start
```

Installation files:

```
npm run dist
```

Builds for all systems are made by GitHub Actions: every change to `main` updates the `latest` release, and a `v*` tag creates a release with that version.

End-to-end check without a window: `node tools/smoke.js` runs the browser in `--headless` mode and goes through settings, bookmarks, the explorer, files, the blocker, downloads, passwords, spaces, addons and a restart. On Linux without a display, run it through `xvfb-run`.

The graphic editor is rebuilt with the `tools/paint/build.sh` script (git and npm are needed); the result is `pages/svgedit.js`.

## Data

Settings, bookmarks, history and the session are in `data.json`, passwords in `vault.json`, addons in the `addons` folder, their data in `addon-data` (in the app data folder, whose path is shown on the `problet://version` page).

## Headless mode

`problet --headless` runs the browser hidden, without a display, with a disposable profile (it is deleted on exit; your own profile is set with `--user-data-dir=`). You can run as many copies as you like.

A one-off load with a JSON report to stdout:

```
problet --headless --fetch=https://example.com --runs=3 --wait=4000 --adblock --text --shot=page.png --eval="document.title"
```

The report has the title, the final address, the load time and a summary of requests by host: how many requests and how many of them were blocked (`hosts`). `--runs` repeats the load from a clean slate, `--size=1280x800` sets the page size. `--insert=code` (or a path to a `.js` file) inserts a script that runs on every opened page before its own scripts; it works in the HTTP control mode too.

HTTP control: `problet --headless [--control-port=N]` prints a `PROBLET_HEADLESS {url, port, token, pid}` line to stdout and writes the same to `/tmp/problet/headless.json`. The token is passed in the `x-token` header.

| Request | What it does |
| --- | --- |
| `GET /tabs` | list of tabs |
| `POST /open {url, wait}` | open an address in a new tab and wait for it to load |
| `POST /eval {tab, js}` | run JS on the page |
| `GET /text?tab=` | page text |
| `GET /screenshot?tab=` | PNG screenshot |
| `GET /requests?clear=1` | summary of requests by host |
| `GET /console?clear=1` | errors and warnings from page consoles (in `--fetch` — the `console` field) |
| `GET /log?lines=200` | tail of the `/tmp/problet/log` log |
| `POST /close {tab}` | close a tab |
| `POST /quit` | quit |
