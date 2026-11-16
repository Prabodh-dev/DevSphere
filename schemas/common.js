import { z } from "zod";

export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "must be a valid id");

export const text = (max, min = 1) => z.string().trim().min(min).max(max);

// Blank form fields count as "not provided".
export const optional = (schema) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional()
  );

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("must be a valid email address"));

export const httpUrl = text(200).pipe(
  z.url({ protocol: /^https?$/, message: "must be a valid http(s) URL" })
);

// Tags arrive as an array (JSON) or as a comma separated string / repeated
// fields (multipart forms).
export const tagList = z.array(text(30)).max(20, "at most 20 tags are allowed");

export const tags = z.preprocess((value) => {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return value;
}, tagList);
