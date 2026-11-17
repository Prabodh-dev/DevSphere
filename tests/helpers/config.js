import { reloadConfig } from "../../config/index.js";

// Runs fn with some environment variables changed, then puts them back. The
// app reads its settings once, so the settings are reloaded around fn.
export async function withEnv(overrides, fn) {
  const saved = {};
  for (const [name, value] of Object.entries(overrides)) {
    saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  reloadConfig();
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    reloadConfig();
  }
}
