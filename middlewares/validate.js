import { validationError } from "../utils/httpError.js";

// Validates request parts against zod schemas. The parsed values are placed on
// req.valid so handlers never read raw client input. Every failing field is
// reported, with the part of the request it came from.
//   validate({ params, query, body })
const validate = (schemas) => (req, res, next) => {
  const valid = {};
  const details = [];

  for (const part of ["params", "query", "body"]) {
    const schema = schemas[part];
    if (!schema) continue;

    const input = part === "body" ? (req.body ?? {}) : req[part];
    const result = schema.safeParse(input);
    if (result.success) {
      valid[part] = result.data;
      continue;
    }
    const seen = new Set();
    for (const issue of result.error.issues) {
      const field = issue.path.join(".");
      // One entry per field: the first problem found.
      if (seen.has(field)) continue;
      seen.add(field);
      details.push({ field, location: part, message: issue.message });
    }
  }

  if (details.length > 0) throw validationError(details);

  req.valid = valid;
  next();
};

export default validate;
