import test from "node:test";
import assert from "node:assert/strict";
import { fullImages } from "../src/lib/image-store.js";

test("full-size images are bounded and recently read entries stay available", () => {
  fullImages.clear();
  for (let i = 0; i < 20; i++) fullImages.set(`image-${i}`, `data:${i}`);
  assert.equal(fullImages.get("image-0"), "data:0");
  fullImages.set("image-20", "data:20");
  assert.equal(fullImages.size, 20);
  assert.equal(fullImages.has("image-1"), false);
  assert.equal(fullImages.get("image-0"), "data:0");
  fullImages.clear();
});
