import http from "http";
import { io as connect } from "socket.io-client";
import { setupSocketIO } from "../../socket.js";

export async function startSocketServer() {
  const server = http.createServer();
  setupSocketIO(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const clients = [];

  return {
    url: `http://127.0.0.1:${port}`,
    client(userId) {
      const socket = connect(`http://127.0.0.1:${port}`, {
        query: userId ? { userId } : {},
        forceNew: true,
        reconnection: false,
      });
      clients.push(socket);
      return socket;
    },
    async close() {
      clients.forEach((c) => c.close());
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves with the first payload of `event`, or rejects after `ms`.
export function once(socket, event, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      ms
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// Resolves true if `event` is NOT received within `ms`.
export function never(socket, event, ms = 400) {
  return new Promise((resolve) => {
    const onEvent = () => resolve(false);
    socket.once(event, onEvent);
    setTimeout(() => {
      socket.off(event, onEvent);
      resolve(true);
    }, ms);
  });
}
