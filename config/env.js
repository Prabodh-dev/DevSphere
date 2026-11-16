const REQUIRED = ["MONGO_URI", "JWT_SECRET"];
const MIN_JWT_SECRET_LENGTH = 32;

const isBlank = (value) => !value || !String(value).trim();

// Returns a list of human readable problems with the environment.
export const getEnvProblems = (env = process.env) => {
  const problems = REQUIRED.filter((name) => isBlank(env[name])).map(
    (name) => `${name} is required`
  );

  if (
    !isBlank(env.JWT_SECRET) &&
    String(env.JWT_SECRET).length < MIN_JWT_SECRET_LENGTH
  ) {
    problems.push(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`
    );
  }
  return problems;
};

// Allowed browser origins, from a comma separated list. A wildcard is ignored.
export const getCorsOrigins = (env = process.env) =>
  String(env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== "*");
