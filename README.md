# protofaker

Generate realistic mock data for **any** Protobuf message, from its schema
alone. No per-message fixture code, no hand-written builders — point it at a
generated schema and it walks the descriptor for you.

```ts
import { mock } from "protofaker";
import { PersonSchema } from "./gen/person_pb.js";

const person = mock(PersonSchema); // fully typed as `Person`
```

Built on [`@bufbuild/protobuf`](https://github.com/bufbuild/protobuf-es)
(protobuf-es v2) for schema reflection and
[`@faker-js/faker`](https://fakerjs.dev/) for the values.

---

## Requirements

protofaker needs the **runtime schema descriptor** that protobuf-es emits
alongside your TypeScript types — the `…Schema` export. That descriptor is what
makes generic mocking possible at all, and it is why protofaker supports exactly
one codegen:

| Codegen | Supported |
| --- | --- |
| `@bufbuild/protoc-gen-es` v2 (protobuf-es) | ✅ |
| `ts-proto`, `protobufjs`, `protoc-gen-ts`, … | ❌ |

`ts-proto` and friends emit plain interfaces with no descriptor to walk, so
there is nothing for protofaker to reflect over. Supporting them would mean a
different design (parsing `.proto` files, or a code generator of its own) and
is out of scope. See [Non-goals](#non-goals).

**Syntax:** protofaker targets `proto3`, which is what its test suite covers.
Nothing in the walker assumes proto3 — field presence is read from the
descriptor rather than inferred — so `proto2` and Editions schemas may well
work, but they are untested and unsupported. If you rely on `required` fields
or closed enums, verify before depending on it.

## Install

```sh
npm install --save-dev protofaker
```

`@bufbuild/protobuf` is a peer dependency — you already have it if you are
generating with protobuf-es.

```yaml
# buf.gen.yaml
version: v2
plugins:
  - remote: buf.build/bufbuild/es
    out: src/gen
    opt: target=ts
```

## Quickstart

Given this schema:

```proto
message Person {
  string id = 1;
  string name = 2;
  string email = 3;
  int32 age = 4;
  Status status = 5;
  Address address = 6;
  repeated string nicknames = 7;
  map<string, string> labels = 9;

  oneof contact_method {
    EmailContact email_contact = 12;
    PhoneContact phone_contact = 13;
    string raw_handle = 14;
  }
}
```

`mock(PersonSchema, { seed: 7 })` produces:

```json
{
  "id": "1c7bf881-47ac-4614-8e37-e09f38e28ca7",
  "name": "Mrs. Josefina Smitham",
  "email": "Magdalen.Reichel90@gmail.com",
  "age": 74,
  "status": "STATUS_SUSPENDED",
  "address": {
    "street": "6540 Michael Ville",
    "city": "Medhurstburgh",
    "postalCode": "98481-3474",
    "country": "Bulgaria"
  },
  "nicknames": ["communis coerceo"],
  "labels": { "pauci": "trado temporibus absens" },
  "rawHandle": "avaritia decimus super"
}
```

Note what happened without any configuration: `id` became a UUID, `email` an
address, `name` a person's name, `city` a city — and exactly one branch of the
`contact_method` oneof was populated.

## API

### `mock(schema, options?)`

Generates one message. The return type is inferred from the schema, so there
is nothing to cast:

```ts
const person = mock(PersonSchema);
person.address?.city; // string | undefined — the real generated type
```

### `mockList(schema, count, options?)`

Generates `count` messages. A `seed` applies to the call as a whole: the
elements differ from one another, but the sequence is the same every run.

```ts
const people = mockList(PersonSchema, 5, { seed: 42 });
```

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `seed` | — | Makes output reproducible. Also pins `refDate`. |
| `maxDepth` | `3` | Message nesting levels below the root. Deeper message fields are left unset. |
| `listLength` | `[1, 3]` | Elements per repeated field. A bare number means exactly that many. |
| `mapSize` | `[1, 3]` | Entries per map field. |
| `includeZeroEnumValue` | `false` | Allow picking the `*_UNSPECIFIED` value. |
| `heuristics` | `true` | Apply the built-in field-name table. |
| `extraHeuristics` | `[]` | Your own heuristics, checked before the built-ins. |
| `optionalFieldChance` | `1` | Probability an explicit-presence field is set. |
| `oneofChance` | `1` | Probability a oneof group gets a member. |
| `overrides` | `{}` | Per-field generators. See below. |
| `scalars` | — | Replace individual scalar generators. |
| `refDate` | now, or `SEEDED_REF_DATE` when seeded | Reference point for generated dates. |
| `faker` | protofaker's own instance | Use your faker instance instead. |

## Overrides

Override a field by bare name, by path from the root message, or by the type
that declares it. **The most specific key wins.**

```ts
import { faker } from "@faker-js/faker";

const person = mock(PersonSchema, {
  overrides: {
    // Any field called `city`, wherever it appears.
    city: () => faker.location.city(),

    // Only the city of Person's own address — beats the bare key above.
    "Person.address.city": "Berlin",

    // Any `country` on an Address, however it was reached.
    "Address.country": "Germany",

    // A literal value, used as-is.
    age: 30,

    // A whole repeated field at once.
    nicknames: ["ada", "lovelace"],
  },
});
```

Key precedence, most specific first:

1. `protofaker.example.v1.Person.address.city` — the fully-qualified path
2. `Person.address.city` — any suffix of the path, longest first
3. `address.city`
4. `Address.city` — the declaring message type
5. `city` — the bare field name

Keys ignore case and underscores, so `postal_code` and `postalCode` are the
same key.

A function is called once **per value** — a repeated field of three elements
calls it three times — and receives a context:

```ts
mock(PersonSchema, {
  overrides: {
    city: (ctx) => {
      ctx.path;    // "protofaker.example.v1.Person.address.city"
      ctx.depth;   // 1
      ctx.stack;   // ["…Person", "…Address"]
      ctx.field;   // the DescField
      return ctx.faker.location.city();
    },
  },
});
```

Anything that is not a function is used as a literal value. To make a function
*be* the value, return it from a generator: `() => myFunction`.

Returning `undefined` leaves the field unset. An override that targets a oneof
member also **selects** that branch, so it takes effect on every run rather
than only when that branch happened to be picked.

## Heuristics

Around sixty field names map to a matching faker call — `email`, `id`,
`firstName`, `phone`, `city`, `zipCode`, `url`, `avatarUrl`, `ipAddress`,
`price`, `createdAt`, and so on. This is what makes the default output read
like real data.

They are **on by default**, and only fire when the field's scalar type can
hold the result (an `id` is a UUID on a `string` field and an integer on an
`int32` one). Overrides always beat heuristics. Turn them off for purely
type-driven values:

```ts
mock(PersonSchema, { heuristics: false });
```

Add your own, checked before the built-ins:

```ts
import { ScalarType } from "@bufbuild/protobuf";

mock(PersonSchema, {
  extraHeuristics: [
    { names: ["email"], types: [ScalarType.STRING], generate: () => "qa@example.com" },
  ],
});
```

## Recursion

Self-referential and mutually recursive messages are common and have no
structural bottom:

```proto
message TreeNode {
  string label = 1;
  TreeNode child = 2;
}
```

`maxDepth` (default `3`) is what makes these terminate. The root is depth 0;
a message field that would exceed the limit is simply **left unset**, never an
error — protobuf has no non-nullable message fields, so an unset one is always
a valid message. Repeated and mapped message fields become empty at the limit.

```ts
mock(TreeNodeSchema, { maxDepth: 1 }).child?.child; // undefined
```

## Well-known types

| Type | Behaviour |
| --- | --- |
| `Timestamp` | A random instant in the 30 days before `refDate`. |
| `Duration` | A non-negative duration up to 24 hours. |
| `StringValue`, `Int32Value`, `BoolValue`, … | The wrapped scalar. protobuf-es unwraps these in generated code, so you get a bare `string`, `number`, `boolean`, … |
| `Struct` | A small random JSON object (typed `JsonObject`). |
| `Value`, `ListValue` | A small random JSON-like value, with its own nesting budget. |
| `Empty` | An empty message. |
| `Any` | **Left unset.** |
| `FieldMask` | **Left unset.** |

### Why `Any` and `FieldMask` are skipped

`google.protobuf.Any` holds an arbitrary packed message identified by a type
URL. Filling one means choosing a concrete type and packing it, which needs a
type registry protofaker does not have. `google.protobuf.FieldMask` names fields
of a *specific* request, so a random mask carries no meaning.

Both are **left unset rather than raising**, so that a message which merely
happens to contain one still mocks successfully — you get every other field.
If you need them, supply them yourself:

```ts
mock(RequestSchema, {
  overrides: { updateMask: create(FieldMaskSchema, { paths: ["name"] }) },
});
```

## Determinism

`seed` makes a run reproducible, which is what you want for snapshot tests:

```ts
expect(toJson(PersonSchema, mock(PersonSchema, { seed: 42 }))).toMatchSnapshot();
```

Two details make this actually hold:

- protofaker uses **its own faker instance**, so seeding a mock never disturbs
  your application's faker state, and vice versa. Pass `faker: yourInstance` to
  share one.
- A seed also pins `refDate` to `SEEDED_REF_DATE` (2024-01-01T00:00:00Z).
  Otherwise `Timestamp` fields would be drawn relative to the wall clock and
  the same seed would produce a different message tomorrow. Unseeded mocks
  still get timestamps near the present. Set `refDate` to control both.

## Non-goals

- **Other codegens.** `ts-proto` and similar emit no runtime descriptor.
- **`proto2` and Editions.** Untested; `proto3` is the supported syntax.
- **Full `Any` resolution.** Would require a type registry.
- **A CLI.** v1 is a library API only.

## License

[MIT](./LICENSE)
