import { chatRoom, liveCodeRoom, sessionRoom, userRoom } from "./rooms.js";

// With the Redis adapter, a room command (leave, disconnect) is sent to Redis
// and carried out when it comes back, on every instance. While Redis is
// unreachable that never happens, not even for this instance's own sockets.
// These helpers also apply the command to the local sockets directly, so
// removing a member, blocking a user or ending a login always takes effect
// here. Doing it twice is harmless.

// Removes every socket of a user from some rooms.
export function removeUserFromRooms(io, userId, rooms) {
  if (!io) return;
  io.in(userRoom(userId)).socketsLeave(rooms);
  io.local.in(userRoom(userId)).socketsLeave(rooms);
}

// Takes every socket out of a chat's rooms (its messages and its live code),
// for a chat that no longer exists.
export function emptyChatRooms(io, chatId) {
  if (!io) return;
  const rooms = [chatRoom(chatId), liveCodeRoom(chatId)];
  io.in(rooms).socketsLeave(rooms);
  io.local.in(rooms).socketsLeave(rooms);
}

// Closes every socket of a user.
export function disconnectUser(io, userId) {
  if (!io) return;
  io.in(userRoom(userId)).disconnectSockets(true);
  io.local.in(userRoom(userId)).disconnectSockets(true);
}

// Closes the sockets opened with these logins.
export function disconnectSessions(io, familyIds) {
  if (!io) return;
  for (const familyId of familyIds) {
    io.in(sessionRoom(familyId)).disconnectSockets(true);
    io.local.in(sessionRoom(familyId)).disconnectSockets(true);
  }
}
