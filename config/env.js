const REQUIRED = ["MONGO_URI", "JWT_SECRET"];

// Returns the names of required variables that are missing or blank.
export const getMissingEnv = (env = process.env) =>
  REQUIRED.filter((name) => !env[name] || !String(env[name]).trim());
