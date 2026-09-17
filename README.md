# Box Review Sync POC

This is a deliberately small Chrome-only prototype for synchronized review of Box video files. The relay sends JSON synchronization events only; every browser loads video directly from Box.

## Run the relay

```sh
cd server
npm install
npm start
```

The local relay listens on `ws://localhost:8787`. The checked-in extension connects to the deployed Render relay by default.

## Install the unpacked extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Keep the relay running, then open a Box video page in two Chrome profiles.
5. In profile A choose **Start Review (Host)**, then choose **Copy Review Link**.
6. Send the copied `/join?room=...` link to the follower. With the extension installed, opening it joins the room and redirects to the host's current Box file.
7. Manual fallback: in profile B open a Box page, enter the room code, and choose **Join Review**.

The Render relay serves a minimal `/join?room=ABCD` page. The extension's join-page content script joins the room, reads the cached host state, stores follower membership, and redirects to the cached Box URL. The existing Box content script then handles playback and future navigation as before.

Use the page DevTools console for `[box-sync]` logs. The first Box run should confirm `detected player`; if it does not, the extension's player adapter needs to be adjusted to the account's Box rendering mode.

The room configuration is stored locally in each profile so a follower remains in the same room when the content script reloads after a host navigation.