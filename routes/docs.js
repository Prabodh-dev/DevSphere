import express from "express";
import helmet from "helmet";
import { createRequire } from "module";
import { buildOpenApiDocument } from "../openapi/spec.js";

const require = createRequire(import.meta.url);
const swaggerDist = require("swagger-ui-dist").getAbsoluteFSPath();

// The only files of the Swagger UI package that are served.
const ASSETS = new Set(["swagger-ui.css", "swagger-ui-bundle.js"]);

const BASE = "/api/v1";

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DevSphere API</title>
    <link rel="stylesheet" href="${BASE}/docs/assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${BASE}/docs/assets/swagger-ui-bundle.js"></script>
    <script src="${BASE}/docs/assets/init.js"></script>
  </body>
</html>
`;

const init = `window.ui = SwaggerUIBundle({
  url: "${BASE}/openapi.json",
  dom_id: "#swagger-ui",
  persistAuthorization: true,
});
`;

// The docs page has its own policy: scripts and connections only to this
// server. It applies to the docs routes alone; every other route keeps the
// strict defaults from the global helmet setup.
const docsPolicy = helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
});

const router = express.Router();

router.get("/openapi.json", (req, res) => {
  res.json(buildOpenApiDocument());
});

router.use("/docs", docsPolicy);

router.get("/docs", (req, res) => {
  res.type("html").send(page);
});

router.get("/docs/assets/init.js", (req, res) => {
  res.type("js").send(init);
});

router.get("/docs/assets/:file", (req, res, next) => {
  if (!ASSETS.has(req.params.file)) return next();
  res.sendFile(req.params.file, { root: swaggerDist });
});

export default router;
