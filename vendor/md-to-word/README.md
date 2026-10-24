This directory includes the reusable Rust library from
[`zhangning-accp/md-to-word`](https://github.com/zhangning-accp/md-to-word),
based on commit `e3782d8858637e3c7b2ba1776cfb763b6c45576b`.

The original library's `lib.rs`, `convert.rs`, and `math.rs` are included under
its MIT license. This copy adds `convert_text_with_base`, allowing an unsaved
editor buffer to resolve relative image paths beside its source document.
Desktop UI modules and build tooling from the standalone app are omitted.
