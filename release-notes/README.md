# Release notes

One file per release of the `@quartzio/*` packages, named after the version (`0.1.0.md`). All packages share one
version. These are the long-form notes for the website and GitHub; each package's `CHANGELOG.md` has the short list
generated from changesets.

## Format

```md
---
version: 0.1.0
date: 2026-10-14
title: First release
summary: One or two sentences for release lists and link previews.
breaking: false
---

A short introduction: what users can do now that they couldn't before.

## Highlights

## New

## Changed

## Breaking changes

## Fixed

## Upgrading
```

- `version`: the published version, without a `v`.
- `date`: the release date, `YYYY-MM-DD`.
- `title`: a short name for the release, without the version number.
- `summary`: plain text, no Markdown.
- `breaking`: `true` when upgrading needs code changes.
- Leave out sections that have nothing in them.
