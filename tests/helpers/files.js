// Small buffers that start with the real signature of each format.
const pad = (head, size = 64) =>
  Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]);

export const png = (size) =>
  pad(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), size);
export const jpeg = (size) =>
  pad(Buffer.from("ffd8ffe000104a464946", "hex"), size);
export const gif = (size) => pad(Buffer.from("GIF89a", "latin1"), size);
export const mp4 = (size) =>
  pad(
    Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42")]),
    size
  );
export const html = () =>
  Buffer.from("<html><script>1</script></html>".repeat(3));
export const pdf = (size) => pad(Buffer.from("%PDF-1.7\n", "latin1"), size);
export const zip = (size) =>
  pad(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), size);
