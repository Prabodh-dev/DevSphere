import { badRequest } from "../utils/httpError.js";

// Validates request parts against zod schemas. The parsed values are placed on
// req.valid so handlers never read raw client input.
//   validate({ params, query, body })
const validate = (schemas) => (req, res, next) => {
  const valid = {};

  for (const part of ["params", "query", "body"]) {
    const schema = schemas[part];
    if (!schema) continue;

    const input = part === "body" ? (req.body ?? {}) : req[part];
    const result = schema.safeParse(input);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue.path.join(".");
      throw badRequest(path ? `${path}: ${issue.message}` : issue.message);
    }
    valid[part] = result.data;
  }

  req.valid = valid;
  next();
};

export default validate;
