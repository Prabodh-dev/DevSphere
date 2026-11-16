import { badRequest } from "./httpError.js";

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export const isObjectId = (value) =>
  typeof value === "string" && OBJECT_ID.test(value);

export function requireObjectId(value, name = "id") {
  if (!isObjectId(value)) throw badRequest(`Invalid ${name}`);
  return value;
}

export function requireString(value, name, { min = 1, max = 1000 } = {}) {
  if (typeof value !== "string") throw badRequest(`${name} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw badRequest(`${name} must be between ${min} and ${max} characters`);
  }
  return trimmed;
}

export function optionalString(value, name, { max = 1000 } = {}) {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, name, { min: 0, max });
}

export function requireOneOf(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw badRequest(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}
