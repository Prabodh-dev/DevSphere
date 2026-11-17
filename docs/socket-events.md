# Socket events

DevSphere uses [Socket.IO](https://socket.io) for real-time features: chat
delivery, typing indicators, presence, live code editing and notifications. The
REST API is described in the OpenAPI document (`/api/v1/openapi.json`, page at
`/api/v1/docs`).

Messages are saved through the REST API (`POST /api/v1/chat/message`); the
socket events only deliver them to other connected members.

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

| Event            | Payload                                  | What it does                                                                                                          |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `join-chat`      | `chatId` (string)                        | Subscribes the socket to the messages and typing events of the chat                                                   |
| `send-message`   | `{ chatId, message }`                    | Delivers `message` as `receive-message` to the other members who joined the chat. The sender does not receive it back |
| `group-message`  | `{ chatId, message }`                    | Like `send-message`, but also delivered to the sender                                                                 |
| `typing`         | `chatId` (string)                        | Tells the other members that the user is typing                                                                       |
| `stop-typing`    | `chatId` (string)                        | Tells the other members that the user stopped typing                                                                  |
| `join-live-code` | `{ chatId }`                             | Subscribes to the shared code document of the chat. If one exists it is sent back as `load-code`                      |
| `code-change`    | `{ chatId, code, language?, fileName? }` | Saves the shared code document and sends `code-update` to the other members who joined it                             |

Payload rules:

- `message` is a string or an object, and at most 16 KB when written as JSON.
  It is passed on as sent.
- `code` is a string of at most 100000 characters. `language` is at most 50
  characters (default `plaintext`) and `fileName` at most 100 (default `main`).

## Server to client

| Event                  | Payload                                         | When                                                                                       |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `receive-message`      | the `message` that was sent                     | A member sent a message to a chat the socket joined                                        |
| `typing`               | user id (string)                                | A member of a joined chat is typing                                                        |
| `stop-typing`          | user id (string)                                | A member of a joined chat stopped typing                                                   |
| `user-online`          | user id (string)                                | Another user connected                                                                     |
| `user-offline`         | user id (string)                                | Another user disconnected                                                                  |
| `load-code`            | the live code document                          | After `join-live-code`, when the chat has one                                              |
| `code-update`          | `{ code, language, fileName }`                  | Another member changed the shared code                                                     |
| `receive-notification` | a notification                                  | The server created a notification for the user (a new follower, or being added to a group) |
| `socket-error`         | `{ event, error: { code, message, details? } }` | An event was refused or failed                                                             |

`receive-notification` is only ever delivered to the sockets of the user it is
for, in the same shape as the items of `GET /api/v1/notifications`. Clients
cannot send notifications.

## Limits

- A single packet is at most 512 KB. A larger packet closes the connection.
- Each connection may send up to 100 events every 10 seconds. Events beyond
  that are dropped, and one `socket-error` with code `RATE_LIMITED` is sent. A
  client that keeps going (50 dropped events in a row) is disconnected.
- Validation limits are listed with the events above.
