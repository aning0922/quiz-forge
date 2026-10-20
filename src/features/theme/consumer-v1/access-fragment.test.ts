import { expect, it } from "vitest";
import { createConsumerToken } from "@/lib/consumer-contract/v1/credentials";
import { takeConsumerAccessFragmentV1 } from "./access-fragment";
it("erases valid and malformed fragments before parsing, never returning a recovery URL", () => {
  const raw = createConsumerToken("access-key");
  for (const hash of [
    `#key=${raw}`,
    "#key=bad",
    `#key=${raw}&key=${raw}`,
    `#key=${raw}&other=value`,
    "",
  ]) {
    let erased = false;
    const location = {
      get hash() {
        expect(erased).toBe(false);
        return hash;
      },
      search: "",
      pathname: "/access",
    };
    const value = takeConsumerAccessFragmentV1(location, (url) => {
      expect(url).toBe("/access");
      erased = true;
    });
    expect(erased).toBe(true);
    expect(value).toBe(hash === `#key=${raw}` ? raw : null);
  }
  const replaced: string[] = [];
  expect(
    takeConsumerAccessFragmentV1(
      { hash: `#key=${raw}`, search: "?other=synthetic", pathname: "/access" },
      (s) => replaced.push(s),
    ),
  ).toBeNull();
  expect(replaced).toEqual(["/access"]);
});
