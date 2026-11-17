import { randomUUID } from "crypto";

// An incoming id is only used when it is short and made of safe characters.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export const REQUEST_ID_HEADER = "X-Request-Id";

// Gives every request an id: the caller's X-Request-Id if it is safe, or a new
// one. The id is returned in the response header and used in logs and errors.
const requestId = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id =
    incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};

export default requestId;
