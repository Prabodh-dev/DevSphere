import mongoose from "mongoose";
import { invalidCursor } from "./httpError.js";

const HEX_ID = /^[0-9a-fA-F]{24}$/;

// A cursor is the base64url of the last item's sort value (a time, or nothing
// when sorting by id alone) and its id, which breaks ties between equal values.
export function encodeCursor({ value = null, id }) {
  const time = value === null ? null : new Date(value).getTime();
  return Buffer.from(JSON.stringify({ v: time, i: String(id) })).toString(
    "base64url"
  );
}

// kind is "date" for lists sorted by a time and "id" for lists sorted by id.
export function decodeCursor(cursor, kind) {
  let parsed;
  try {
    parsed = JSON.parse(
      Buffer.from(String(cursor), "base64url").toString("utf8")
    );
  } catch {
    throw invalidCursor();
  }

  const valid =
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    typeof parsed.i === "string" &&
    HEX_ID.test(parsed.i) &&
    (kind === "date"
      ? Number.isFinite(parsed.v) && parsed.v >= 0
      : parsed.v === null);
  if (!valid) throw invalidCursor();

  return {
    value: kind === "date" ? new Date(parsed.v) : null,
    id: new mongoose.Types.ObjectId(parsed.i),
  };
}

// Keyset pagination. Items are ordered by `sortField` and then by _id, and the
// cursor points at the last item returned, so a page boundary stays put when
// items are added or removed elsewhere in the list.
//
//   direction -1: newest (or highest) first; 1: oldest (or lowest) first.
//   sortField "_id" sorts by id alone.
//   build(query) can add populate/select to the query.
export async function paginate(
  Model,
  { filter = {}, sortField = "createdAt", direction = -1, limit, cursor, build }
) {
  const byId = sortField === "_id";
  const op = direction === -1 ? "$lt" : "$gt";

  let query = filter;
  if (cursor) {
    const { value, id } = decodeCursor(cursor, byId ? "id" : "date");
    const after = byId
      ? { _id: mongoose.trusted({ [op]: id }) }
      : {
          $or: [
            { [sortField]: mongoose.trusted({ [op]: value }) },
            { [sortField]: value, _id: mongoose.trusted({ [op]: id }) },
          ],
        };
    query = { $and: [filter, after] };
  }

  const sort = byId
    ? { _id: direction }
    : { [sortField]: direction, _id: direction };
  let find = Model.find(query)
    .sort(sort)
    .limit(limit + 1);
  if (build) find = build(find) ?? find;

  const docs = await find;
  const page = docs.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    docs.length > limit
      ? encodeCursor({ value: byId ? null : last[sortField], id: last._id })
      : null;

  return { docs: page, nextCursor };
}
