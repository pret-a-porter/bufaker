# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, the public API may change in a minor release.

## [0.1.0] - 2026-09-25

Initial release.

### Added

- `mock(schema, options?)` and `mockList(schema, count, options?)`, generating
  a fully populated message from a protobuf-es `DescMessage`, with the return
  type inferred as `MessageShape<Desc>`.
- Generation for every proto field kind: all 15 scalar types, enums, nested
  messages, repeated fields, maps, and oneof groups.
- Well-known type handling for `Timestamp`, `Duration`, the `*Value` wrappers,
  `Struct`, `Value`, `ListValue` and `Empty`. `Any` and `FieldMask` are left
  unset — see the README for why.
- A depth guard (`maxDepth`, default 3) that makes self-referential and
  mutually recursive schemas terminate.
- An overrides system matching by field name, by path from the root, or by
  declaring message type, with the most specific key winning.
- Built-in field-name heuristics (`email`, `id`, `createdAt`, and ~60 more),
  on by default and disabled with `heuristics: false`.
- `seed` for reproducible output, including a pinned reference date so that
  generated timestamps do not vary with the wall clock.
- `refDate`, setting the point that generated dates are drawn relative to.

[0.1.0]: https://github.com/pret-a-porter/protofaker/releases/tag/v0.1.0
