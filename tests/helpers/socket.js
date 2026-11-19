import http from "http";
import { io as connect } from "socket.io-client";
import app from "../../app.js";
import { setupSocketIO } from "../../socket.js";
import { closeRedis } from "../../config/redis.js";

export async function startSocketServer(options) {
  const server = http.createServer(app);
  const io = setupSocketIO(server, options);
  // Lets REST handlers (block, group changes, notifications) reach sockets.
  app.set("io", io);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const clients = [];

  const open = (auth, extra = {}) => {
    const socket = connect(`http://127.0.0.1:${port}`, {
      auth,
      forceNew: true,
      reconnection: false,
      ...extra,
    });
    clients.push(socket);
    return socket;
  };

  return {
    io,
    url: `http://127.0.0.1:${port}`,
    // Connects as a user and resolves once the connection is established.
    async client(user, extra) {
      const socket = open({ token: user.token }, extra);
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    },
    // For connections that may be refused; resolves with the outcome.
    async tryConnect(auth, extra) {
      const socket = open(auth, extra);
      return new Promise((resolve) => {
        socket.once("connect", () => resolve({ socket, connected: true }));
        socket.once("connect_error", (err) =>
          resolve({ socket, connected: false, error: err.message })
        );
      });
    },
    async close() {
      clients.forEach((c) => c.close());
      io.close();
      await new Promise((resolve) => server.close(() => resolve()));
      // setupSocketIO starts the shared Redis client. Release it, or the next
      // test file in the same worker inherits a client it did not ask for.
      await closeRedis();
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

// Emits an event with an acknowledgement callback and resolves with the reply.
export function emitAck(socket, event, payload, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no acknowledgement for "${event}"`)),
      ms
    );
    socket.emit(event, payload, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
  });
}

// Every payload of `event` received during the next `ms`.
export async function collect(socket, event, ms = 400) {
  const received = [];
  const onEvent = (payload) => received.push(payload);
  socket.on(event, onEvent);
  await sleep(ms);
  socket.off(event, onEvent);
  return received;
}
