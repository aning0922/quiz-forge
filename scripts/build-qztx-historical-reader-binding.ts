import { writeFile } from "node:fs/promises";
import prettier from "prettier";
import {
  collectQztxHistoricalReaderBinding,
  QZTX_HISTORICAL_BINDING_PATH,
} from "./qztx-historical-reader-binding";

const binding = await collectQztxHistoricalReaderBinding(process.cwd());
await writeFile(
  QZTX_HISTORICAL_BINDING_PATH,
  await prettier.format(JSON.stringify(binding), {
    filepath: QZTX_HISTORICAL_BINDING_PATH,
  }),
);
console.log(
  JSON.stringify({
    status: "FROZEN_READ_ONLY_CLOSURE",
    files: binding.closure.files.length,
    sha256: binding.sha256,
    access: binding.access,
  }),
);
