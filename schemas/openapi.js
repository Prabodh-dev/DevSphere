import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// Lets schemas carry OpenAPI details (examples, descriptions) via .openapi().
// Imported by every module that builds schemas, so it always runs first.
extendZodWithOpenApi(z);

export { z };
