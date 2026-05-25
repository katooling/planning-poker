# Planning Poker

Browser-based planning poker where a host runs a session and guests join via MQTT quick join or manual WebRTC signaling.

## Language

**Session**:
A single planning poker game run by one host with zero or more guests at the table.
_Avoid_: Room (use only for join-code addressing), game (too generic)

**Home screen**:
The first screen guests and hosts see before entering a session — create room, join room, or accept an invite.
_Avoid_: Landing page, start page

**Plain home**:
The home screen with no `room` query parameter — display name plus create or join actions only.
_Avoid_: Default landing, empty URL

**Invite link**:
A URL that includes a `room` query parameter so the guest already knows which session to join.
_Avoid_: Deep link, magic link

**Invite home**:
The home screen shown for an invite link before the guest submits — join session copy, name, optional PIN, no join link status.
_Avoid_: Join link landing, pre-connect form

**Join link flow**:
The guest path that starts from an invite link on the home screen (name, optional PIN, then in-page status while connecting).
_Avoid_: Quick join (also names the connection strategy), auto-join

**Guest connect screen**:
The separate view where a guest enters a room code and PIN (or manual WebRTC codes) when not using the join link flow.
_Avoid_: Join screen, connect view

**Plain join**:
A guest starting from plain home via Join Room — name on home, then room code and PIN on the guest connect screen.
_Avoid_: Manual join, secondary join path

**Host lobby**:
The screen where the host shares room access and approves guests before starting the game.
_Avoid_: Host view, lobby screen

**Join link status**:
The in-page panel on the home screen that shows connecting, waiting for host approval, or entering the table during the join link flow.
_Avoid_: Loader, connecting overlay

**Explicit join**:
The guest must submit from invite home or plain join before any connection attempt or join link status appears; opening an invite link alone does not connect.
_Avoid_: Auto-join, quick connect on load

## Flagged ambiguities

(None yet.)
