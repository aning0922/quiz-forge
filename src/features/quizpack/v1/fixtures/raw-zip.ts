import { deflateRawSync } from "node:zlib";
import { createRequire } from "node:module";
const crc32 = createRequire(import.meta.url)("buffer-crc32") as {
  unsigned(bytes: Buffer): number;
};
/** Independent byte-level fixture: deliberately does not use the production builder. */
export function rawZip(
  items: { name: string; bytes: Buffer; method?: number; tail?: Buffer }[],
): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name);
    const method = item.method ?? 0;
    const data = Buffer.concat([
      method === 8 ? deflateRawSync(item.bytes) : item.bytes,
      item.tail ?? Buffer.alloc(0),
    ]);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32.unsigned(item.bytes), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(item.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(0x314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc32.unsigned(item.bytes), 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(item.bytes.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
