# Box Review Sync POC

This is a deliberately small Chrome-only prototype for synchronized review of Box video files. The relay sends JSON synchronization events only; every browser loads video directly from Box.

## Run the relay

```sh
cd server
npm install
npm start
```

The relay listens on `ws://localhost:8787`.

## Install the unpacked extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Keep the relay running, then open a Box video page in two Chrome profiles.
5. In profile A choose **Start Review (Host)**. The room code appears in the extension popup after the connection is established.
6. In profile B enter that code and choose **Join Review (Follower)**.

Use the page DevTools console for `[box-sync]` logs. The first Box run should confirm `detected player`; if it does not, the extension's player adapter needs to be adjusted to the account's Box rendering mode.

The room configuration is stored locally in each profile so a follower remains in the same room when the content script reloads after a host navigation.