import test from "node:test";
import assert from "node:assert/strict";
import { dragProps } from "../src/lib/gesture.js";

function fixture(options = {}) {
  const calls = [];
  const target = { setPointerCapture(id) { calls.push(["capture", id]); } };
  const handlers = dragProps({
    claim: () => true,
    move: (dx, dy) => calls.push(["move", dx, dy]),
    end: (dx, dy) => calls.push(["end", dx, dy]),
    cancel: () => calls.push(["cancel"]),
    ...options,
  });
  const pointer = (x = 10, y = 10, extra = {}) => ({
    clientX: x, clientY: y, pointerId: 7, pointerType: "mouse", button: 0,
    currentTarget: target, ...extra,
  });
  return { calls, target, handlers, pointer };
}

test("a tap leaves the child control as the click target", () => {
  const { calls, handlers, pointer } = fixture();
  handlers.onPointerDown(pointer());
  handlers.onPointerMove(pointer(12, 11));
  handlers.onPointerUp(pointer(12, 11));
  assert.deepEqual(calls, [["end", 2, 1]]);
});

test("a claimed drag captures once and keeps moving and finishing", () => {
  const { calls, handlers, pointer } = fixture();
  handlers.onPointerDown(pointer());
  assert.deepEqual(calls, []);
  handlers.onPointerMove(pointer(25, 11));
  handlers.onPointerMove(pointer(40, 12));
  handlers.onPointerUp(pointer(50, 12));
  assert.deepEqual(calls, [["capture", 7], ["move", 15, 1], ["move", 30, 2], ["end", 40, 2]]);
});

test("rejected and perpendicular gestures never capture or finish", () => {
  for (const [options, point] of [[{ claim: () => false }, [30, 10]], [{}, [10, 30]]]) {
    const { calls, handlers, pointer } = fixture(options);
    handlers.onPointerDown(pointer());
    handlers.onPointerMove(pointer(...point));
    handlers.onPointerUp(pointer(...point));
    assert.deepEqual(calls, []);
  }
});

test("cancellation ends a claimed drag without invoking end", () => {
  const { calls, handlers, pointer } = fixture();
  handlers.onPointerDown(pointer());
  handlers.onPointerMove(pointer(30, 10));
  handlers.onPointerCancel(pointer(30, 10));
  handlers.onPointerUp(pointer(40, 10));
  assert.deepEqual(calls, [["capture", 7], ["move", 20, 0], ["cancel"]]);
});

test("unsupported capture still allows drag and later tap recovery", () => {
  const { calls, target, handlers, pointer } = fixture();
  target.setPointerCapture = () => { throw new Error("unsupported"); };
  handlers.onPointerDown(pointer());
  handlers.onPointerMove(pointer(30, 10));
  handlers.onPointerUp(pointer(30, 10));
  handlers.onPointerDown(pointer());
  handlers.onPointerUp(pointer());
  assert.deepEqual(calls, [["move", 20, 0], ["end", 20, 0], ["end", 0, 0]]);
});

test("touch continues through touch events without pointer capture", () => {
  const { calls, target, handlers, pointer } = fixture();
  handlers.onPointerDown(pointer(10, 10, { pointerType: "touch" }));
  const touch = (x) => ({ currentTarget: target, touches: [{ clientX: x, clientY: 10 }], changedTouches: [{ clientX: x, clientY: 10 }] });
  handlers.onTouchStart(touch(10));
  handlers.onTouchMove(touch(30));
  handlers.onTouchEnd(touch(35));
  assert.deepEqual(calls, [["move", 20, 0], ["end", 25, 0]]);
});

test("secondary mouse buttons do not start gestures", () => {
  const { calls, handlers, pointer } = fixture();
  handlers.onPointerDown(pointer(10, 10, { button: 2 }));
  handlers.onPointerMove(pointer(30, 10));
  handlers.onPointerUp(pointer(30, 10));
  assert.deepEqual(calls, []);
});
