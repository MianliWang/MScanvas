/** New explicitly synthetic inputs for M7.4; no physical acquisition claim. */
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { writeM73NativeFixture } from "./m73NativeFixture";

export function writeM74NativeFixture(path: string, count = 12) {
  writeM73NativeFixture(path);
  const original = readFileSync(path, "utf8").replaceAll("M73", "M74").replaceAll("M7.3", "M7.4");
  if (count === 12) { writeFileSync(path, original); return; }
  if (!Number.isSafeInteger(count) || count < 1 || count > 250_000) throw Error("Synthetic input count exceeds this harness budget.");
  const start = original.indexOf('<spectrum index="0"');
  const end = original.indexOf("</spectrum>", start) + "</spectrum>".length;
  const template = original.slice(start, end);
  const file = openSync(path, "w");
  try {
    writeSync(file, original.slice(0, start).replace('spectrumList count="12"', `spectrumList count="${count}"`));
    for (let index = 0; index < count; index++) {
      writeSync(file, template.replace('index="0"', `index="${index}"`).replace('scan=1"', `scan=${index + 1}"`)
        .replace('name="scan start time" value="0"', `name="scan start time" value="${index / 60}"`) + "\n");
    }
    writeSync(file, "</spectrumList></run></mzML>\n");
  } finally { closeSync(file); }
}

/** All PNG chunk CRCs, dimensions and physical resolution are checked. */
export function inspectNativePng(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error("Not a PNG.");
  let width = 0, height = 0, ppmX = 0, ppmY = 0, unit = 0, ended = false;
  const chunks: string[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw Error("Truncated PNG chunk.");
    const name = bytes.toString("ascii", offset + 4, offset + 8), body = bytes.subarray(offset + 8, end - 4);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, end - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) throw Error(`Invalid ${name} CRC.`);
    if (name === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); }
    if (name === "pHYs") { ppmX = body.readUInt32BE(0); ppmY = body.readUInt32BE(4); unit = body[8]!; }
    chunks.push(name); offset = end;
    if (name === "IEND") { ended = true; if (offset !== bytes.length) throw Error("Trailing PNG bytes."); }
  }
  if (!ended || !width || !height) throw Error("Incomplete PNG.");
  return { width, height, ppmX, ppmY, unit, chunks, everyChunkCrcValid: true };
}
