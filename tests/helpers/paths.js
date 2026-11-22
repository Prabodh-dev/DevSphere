// A path with forward slashes, whatever the platform, so lists of files can be
// compared with plain strings. (path.relative gives backslashes on Windows.)
export const toPosix = (file) => file.replace(/\\/g, "/");
