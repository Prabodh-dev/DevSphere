// Socket.IO room names are always built on the server from verified ids.
export const userRoom = (userId) => `user:${userId}`;
export const chatRoom = (chatId) => `chat:${chatId}`;
export const liveCodeRoom = (chatId) => `live:${chatId}`;
export const sessionRoom = (sessionId) => `session:${sessionId}`;
