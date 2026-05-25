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

**Pending rejoin**:
A guest who was in the session before disconnects and asks to come back; the host must approve or reject before they rejoin.
_Avoid_: Reconnect request, pending guest (too generic)

**Room access panel**:
The host lobby area for sharing invite link, room code, PIN, and QR — and for acting on pending rejoins.
_Avoid_: Share panel, invite card

**Join link status**:
The in-page panel on the home screen that shows connecting, waiting for host approval, or entering the table during the join link flow.
_Avoid_: Loader, connecting overlay

**Explicit join**:
The guest must submit from invite home or plain join before any connection attempt or join link status appears; opening an invite link alone does not connect.
_Avoid_: Auto-join, quick connect on load

**Taken display name**:
A display name already used in the session by a connected guest or by a guest waiting for host approval (including pending rejoin). Disconnected roster entries do not count. The host’s name counts; two different guests may not share a name while either is connected or pending.
_Avoid_: Duplicate name, name clash

**Session-unique display name**:
Each connected or pending guest must use a distinct display name within the session (after the app’s normal name sanitization). Comparison is case-sensitive (`Alex` and `alex` are different names).
_Avoid_: Unique username, global name lock

**Display name collision**:
A joining guest chooses a taken display name and is turned back to pick another name before entering the table.
_Avoid_: Name conflict error, duplicate profile

**Collision feedback (invite home)**:
After a collision on the join link flow, the guest remains on invite home with an error notice and an editable name field — not the guest connect screen and not a waiting-for-approval state.
_Avoid_: PIN-style escalation, stuck waiting UI

**Host-authoritative join gate**:
The host session is the source of truth for whether a guest may enter; the guest shows errors only after the host rejects or accepts the attempt.
_Avoid_: Client-side validation, pre-check

**Relay join**:
A guest entering a session via MQTT room code (invite link or quick join on the guest connect screen), as opposed to manual WebRTC signal codes.
_Avoid_: Quick join (also names the connection strategy), MQTT path

## Flagged ambiguities

(None yet.)
