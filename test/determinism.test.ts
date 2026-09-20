import { describe, expect, it } from "vitest";
import { Faker, en } from "@faker-js/faker";
import { toJson } from "@bufbuild/protobuf";
import { bufakerFaker, mock, mockList } from "../src/index.js";
import { PersonSchema } from "./fixtures/gen/bufaker/test/v1/basic_pb.js";
import { KitchenSinkSchema } from "./fixtures/gen/bufaker/test/v1/kitchen_sink_pb.js";

describe("seeding", () => {
  it("produces the same message for the same seed", () => {
    expect(mock(PersonSchema, { seed: 42 })).toEqual(mock(PersonSchema, { seed: 42 }));
  });

  it("produces different messages for different seeds", () => {
    expect(mock(PersonSchema, { seed: 1 })).not.toEqual(mock(PersonSchema, { seed: 2 }));
  });

  it("is unaffected by intervening unseeded calls", () => {
    const first = mock(PersonSchema, { seed: 42 });
    mock(KitchenSinkSchema);
    mock(PersonSchema);
    expect(mock(PersonSchema, { seed: 42 })).toEqual(first);
  });

  it("seeds a whole mockList, not each element", () => {
    const a = mockList(PersonSchema, 5, { seed: 7 });
    const b = mockList(PersonSchema, 5, { seed: 7 });
    expect(a).toEqual(b);
    // The five elements still differ from each other.
    expect(new Set(a.map((p) => p.id)).size).toBe(5);
  });

  it("leaves the caller's own faker untouched", () => {
    const mine = new Faker({ locale: en });
    mine.seed(1);
    const before = mine.string.uuid();

    mine.seed(1);
    mock(PersonSchema, { seed: 999 });
    expect(mine.string.uuid()).toBe(before);
  });

  it("seeds a caller-supplied faker instance", () => {
    const mine = new Faker({ locale: en });
    const a = mock(PersonSchema, { seed: 5, faker: mine });
    const b = mock(PersonSchema, { seed: 5, faker: mine });
    expect(a).toEqual(b);
    // And that instance is genuinely the one in use.
    expect(a).toEqual(mock(PersonSchema, { seed: 5, faker: bufakerFaker }));
  });
});

describe("snapshots", () => {
  // These pin the generation logic itself: any change to field ordering, to
  // how many faker draws a field kind makes, or to the heuristics will move
  // these values and require a deliberate snapshot update.
  it("matches a fixed-seed Person", () => {
    const person = mock(PersonSchema, { seed: 1234, listLength: 2, mapSize: 2 });
    expect(toJson(PersonSchema, person)).toMatchSnapshot();
  });

  it("matches a fixed-seed KitchenSink", () => {
    const sink = mock(KitchenSinkSchema, { seed: 1234, listLength: 2, mapSize: 2 });
    expect(toJson(KitchenSinkSchema, sink)).toMatchSnapshot();
  });

  it("matches a fixed-seed Person with heuristics off", () => {
    const person = mock(PersonSchema, {
      seed: 1234,
      heuristics: false,
      listLength: 1,
      mapSize: 1,
    });
    expect(toJson(PersonSchema, person)).toMatchSnapshot();
  });
});
