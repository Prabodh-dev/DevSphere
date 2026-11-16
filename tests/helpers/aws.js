import { vi } from "vitest";

// Shared mocks for the S3 client and the URL presigner. Call from a test file
// with the vi.mock factories below (see tests/media.test.js).
export const sentCommands = (send) =>
  send.mock.calls.map(([command]) => ({
    name: command.constructor.name,
    ...command.input,
  }));

export const fakePresign = vi.fn(
  async (_client, command, options) =>
    `https://signed.example.test/${command.input.Key}?expires=${options.expiresIn}`
);
