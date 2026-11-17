import hljs from "highlight.js";

// Highlights code. Unknown or missing languages are shown as plain text.
export function highlight(code, language) {
  const validLang =
    language && hljs.getLanguage(language) ? language : "plaintext";
  return hljs.highlight(code, { language: validLang }).value;
}
