import { pathToFileURL } from "node:url";

const inkPackageDirectory = process.argv[2];

if (!inkPackageDirectory) {
  throw new Error(
    "Usage: node docs/oss-r/ink-roundtrip.mjs /absolute/path/to/inkjs/package",
  );
}

const moduleUrl = pathToFileURL(
  `${inkPackageDirectory.replace(/\/$/, "")}/dist/ink-full.mjs`,
).href;
const { Compiler } = await import(moduleUrl);

const source = `Hello
* [A]
  A result
  -> END
* [B]
  B result
  -> END`;

const firstStory = new Compiler(source).Compile();
firstStory.Continue();
const savedState = firstStory.state.ToJson();
firstStory.ChooseChoiceIndex(1);
const firstOutput = firstStory.Continue();

const restoredStory = new Compiler(source).Compile();
restoredStory.Continue();
restoredStory.state.LoadJson(savedState);
restoredStory.ChooseChoiceIndex(1);
const restoredOutput = restoredStory.Continue();

if (
  firstOutput !== "B result\n" ||
  restoredOutput !== firstOutput ||
  restoredStory.state.ToJson() !== firstStory.state.ToJson()
) {
  throw new Error(
    "inkjs state round-trip did not preserve the selected branch.",
  );
}

console.log(
  JSON.stringify({
    choicesBeforeSave: ["A", "B"],
    output: firstOutput,
    stateRoundTripEqual: true,
  }),
);
