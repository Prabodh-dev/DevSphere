// Reads one sample out of the Prometheus text format.
//   metricValue(text, "http_request_duration_seconds_count", { route: "/x" })
export function metricValue(text, name, labels = {}) {
  for (const line of text.split("\n")) {
    if (!line.startsWith(name) || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)$/);
    if (!match || match[1] !== name) continue;

    const found = {};
    for (const part of (match[2] ?? "").matchAll(
      /(\w+)="((?:[^"\\]|\\.)*)"/g
    )) {
      found[part[1]] = part[2];
    }
    if (Object.entries(labels).every(([key, value]) => found[key] === value)) {
      return Number(match[3]);
    }
  }
  return 0;
}

// Every label set used by a metric.
export function labelSets(text, name) {
  const sets = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith(`${name}{`)) continue;
    const labels = {};
    for (const part of line
      .slice(name.length + 1, line.lastIndexOf("}"))
      .matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
      labels[part[1]] = part[2];
    }
    sets.push(labels);
  }
  return sets;
}
