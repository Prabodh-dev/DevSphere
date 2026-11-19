# Socket events

DevSphere uses [Socket.IO](https://socket.io) for real-time features: chat
delivery, typing indicators, presence, live code editing and notifications. The
REST API is described in the OpenAPI document (`/api/v1/openapi.json`, page at
`/api/v1/docs`).

Sending a message, over REST (`POST /api/v1/chat/message`) or with the
`send-message` socket event, goes through the same server code. It saves the
message, updates the chat's latest message and then delivers it from the
server. Clients never choose who receives a message: it goes to the members of
the chat, whichever socket they use and whether or not they joined the chat
room. Blocked members and people who are no longer members do not receive it.

## Connecting

Send the current access token in the handshake:

```js
import { io } from "socket.io-client";

const socket = io("https://api.example.com", { auth: { token: accessToken } });

socket.on("connect_error", (err) => {
  // err.message is "Authentication failed" for any problem with the token
});
```

- The token must be a valid, unexpired access token whose login (session) is
  still active, for a user who is not blocked. Anything else fails with
  `connect_error` and the message `Authentication failed`.
- Identity comes from the token only. Values such as a user id in the query
  string are ignored.
- The connection ends when the access token expires, when the login is ended
  (logout, revoked session, password change on another login) and when the user
  is blocked. Refresh the token (`POST /api/v1/auth/refresh`) and reconnect with
  the new one.
- Every socket is placed in the private room of its user (used for
  notifications) and in a room for its login. Chat rooms are joined with
  `join-chat`; room names are built by the server.

## Errors

When an event cannot be handled the server answers on that socket with a
`socket-error` event. It has the same error shape as the REST API, plus the name
of the event that caused it:

```json
{
  "event": "join-chat",
  "error": {
    "code": "FORBIDDEN",
    "message": "Not a member of this chat"
  }
}
```

`error.details` is present for validation errors, as a list of
`{ field, message }`.

| Code               | When                                                         |
| ------------------ | ------------------------------------------------------------ |
| `VALIDATION_ERROR` | The payload is missing, has the wrong type or is too large   |
| `FORBIDDEN`        | The user is not a member of the chat                         |
| `RATE_LIMITED`     | Too many events were sent (see Limits)                       |
| `INTERNAL_ERROR`   | Something unexpected failed on the server (`Request failed`) |

## Client to server

Chat ids are 24 character hexadecimal ids. All chat events require the user to
be a member of the chat; `join-chat` and `join-live-code` are refused otherwise.

| Event            | Payload                                                | What it does                                                                                                       |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `join-chat`      | `chatId` (string)                                      | Subscribes the socket to the messages and typing events of the chat                                                |
| `send-message`   | `{ chatId, type?, text?, code? }`                      | Saves a message (the same body as `POST /api/v1/chat/message`) and delivers it to the members as `receive-message` |
| `group-message`  | `{ chatId, type?, text?, code? }`                      | The older name of `send-message`. It does the same                                                                 |
| `mark-read`      | `{ chatId, messageId }`                                | Marks the chat as read up to a message (see Read state). Replies with the new state                                |
| `typing`         | `chatId` (string)                                      | Tells the other members that the user is typing                                                                    |
| `stop-typing`    | `chatId` (string)                                      | Tells the other members that the user stopped typing                                                               |
| `join-live-code` | `{ chatId }`                                           | Subscribes to the shared code document of the chat. If one exists it is sent back as `load-code`                   |
| `code-change`    | `{ chatId, baseRevision, code, language?, fileName? }` | Edits the shared code document if `baseRevision` is its current revision (see Live code editing)                   |

Payload rules:

- `send-message` follows the REST body: `type` is `text` (default), `media` or
  `code`; `text` is 1 to 5000 characters; a code message carries
  `code: { language?, content }` with at most 100000 characters of content.
  Other fields, such as a list of recipients, are ignored.
- `baseRevision` is a whole number, 0 or more. `code` is a string of at most 100000 characters. `language` is at most 50
  characters (default `plaintext`) and `fileName` at most 100 (default `main`).

## Server to client

| Event                  | Payload                                                     | When                                                                                       |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `receive-message`      | the stored message                                          | A message was sent to a chat the user is a member of (see Sending messages)                |
| `read-receipt`         | `{ chatId, userId, messageId, readAt }`                     | A member's read marker moved forward in a chat the socket joined (see Read state)          |
| `typing`               | user id (string)                                            | A member of a joined chat is typing                                                        |
| `stop-typing`          | user id (string)                                            | A member of a joined chat stopped typing                                                   |
| `user-online`          | user id (string)                                            | Another user connected                                                                     |
| `user-offline`         | user id (string)                                            | Another user disconnected                                                                  |
| `load-code`            | the live code document                                      | After `join-live-code`, when the chat has one                                              |
| `code-update`          | `{ chatId, code, language, fileName, revision, updatedBy }` | Another member's edit was accepted                                                         |
| `code-conflict`        | `{ chatId, document }`                                      | Your edit was refused because it was not made on the current revision                      |
| `receive-notification` | a notification                                              | The server created a notification for the user (a new follower, or being added to a group) |
| `socket-error`         | `{ event, error: { code, message, details? } }`             | An event was refused or failed                                                             |

`receive-notification` is only ever delivered to the sockets of the user it is
for, in the same shape as the items of `GET /api/v1/notifications`. Clients
cannot send notifications.

## Sending messages

`receive-message` carries the stored message, in the same shape as the items of
`GET /api/v1/chat/message/{chatId}` (`_id`, `chat`, `sender`, `type`, `text` or
`code`, `createdAt`). It is delivered to the chat room and to the private room
of every current member, once per socket. The sender's own sockets receive it
too, so a second tab stays in step; use `_id` to tell it from a copy you
already show.

## Live code editing

Each chat has one shared code document with a `revision`, a whole number that
starts at 0 and goes up by one for every accepted edit. `load-code` and the
REST endpoint `GET /api/v1/live-code/{chatId}` return the document with its
`revision`. A chat nobody has edited has no document; its first edit uses
`baseRevision: 0`.

An edit names the revision it was made on:

```js
socket.emit("code-change", { chatId, baseRevision: 4, code }, (reply) => {
  // accepted: { ok: true, chatId, revision: 5 }
  // refused:  { ok: false, error: { code: "REVISION_CONFLICT", message },
  //             chatId, document: { code, language, fileName, revision, updatedBy } }
});
```

- If `baseRevision` is the current revision, the edit is accepted, the revision
  goes up by one and the other members in the live room receive `code-update`
  with the new `revision`. Updates for one chat arrive in revision order.
- Otherwise nothing changes and nobody else is told. The sender gets the
  current `document` in the acknowledgement and as a `code-conflict` event, so
  it can merge and send again on `document.revision`. When two members edit on
  the same revision, exactly one of them is accepted.
- One connection's edits are handled in the order they were sent, so a client
  may send `baseRevision` 4, 5, 6 without waiting for each reply.
- Edits are kept in a working copy (in Redis when it is configured, so every
  app instance agrees) and written to MongoDB after `LIVE_CODE_FLUSH_MS`
  without further edits, at the latest five times that while edits continue.
  They are also written when the editing user disconnects and when the server
  shuts down. Reading the document returns the newest edit even if it is not
  written yet.
- The size limits are unchanged.

## Presence

A user is online while they have at least one connection, on any app instance.
`user-online` is sent to the other connected users when their first connection
opens and `user-offline` when their last one closes; further tabs send nothing.
When the last connection closes the time is stored as the user's last seen
time. `GET /api/v1/presence?ids=a,b,c` returns it, for people the caller shares
a chat with or follows (see the API reference).

## Read state

The server keeps, for each member of a chat, the last message they have read.
It is set with `mark-read` or `PUT /api/v1/chat/{chatId}/read`, and the chat
list (`GET /api/v1/chat`) shows `unreadCount` for each chat: the messages from
other members that come after it.

- Only members can set it, and only forward. Marking an older message, or the
  one already marked, changes nothing and is not announced.
- A change is sent to the chat room as `read-receipt`:
  `{ chatId, userId, messageId, readAt }`.
- The reply to `mark-read` is `{ ok: true, chatId, messageId, unreadCount,
changed }`. `messageId` is the marker after the call, which can be newer than
  the one sent.

## Acknowledgements

Every client to server event may be sent with an acknowledgement callback as
its last argument. The server calls it with `{ ok: true, ...result }`, or with
`{ ok: false, error: { code, message, details? } }` when the event is refused.
When a callback is given the error is not also sent as `socket-error`.

```js
socket.emit("send-message", { chatId, text: "hello" }, (reply) => {
  // { ok: true, id, chatId, createdAt }
});
```

`send-message` and `group-message` reply with the stored message's `id`, its
`chatId` and its `createdAt`.

## Limits

- A single packet is at most 512 KB. A larger packet closes the connection.
- Each connection may send up to 100 events every 10 seconds. Events beyond
  that are dropped, and one `socket-error` with code `RATE_LIMITED` is sent. A
  client that keeps going (50 dropped events in a row) is disconnected.
- Validation limits are listed with the events above.
