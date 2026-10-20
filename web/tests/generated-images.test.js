import test from "node:test";
import assert from "node:assert/strict";
import { placeImages, wireMessage } from "../src/lib/attachments.js";

const ref = "vaelo-image:" + "a".repeat(24);
const reply = `Here it is:\n\n![Teardrop car](${ref})`;

test("a generated picture takes its reference's place once it arrives", () => {
  assert.equal(placeImages(reply, new Map()), reply);
  assert.equal(
    placeImages(reply, new Map([[ref, "data:image/jpeg;base64,AAAA"]])),
    "Here it is:\n\n![Teardrop car](data:image/jpeg;base64,AAAA)",
  );
});

test("a reference that never got its picture says so when the reply ends", () => {
  assert.match(placeImages(reply, new Map(), true), /Teardrop car could not be shown/);
  assert.match(placeImages(reply, new Map([[ref, ""]])), /could not be shown/);
});

test("earlier pictures are not sent back to the model", () => {
  const message = { role: "assistant", content: "Look ![Car](data:image/png;base64,AAAA) there" };
  assert.equal(wireMessage(message).content, "Look [Image generated earlier: Car] there");
});
