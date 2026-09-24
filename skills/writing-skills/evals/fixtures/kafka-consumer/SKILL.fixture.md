---
name: kafka-consumer
description: Configure Kafka consumer groups for at-least-once processing. Use when setting up consumers, choosing a partition assignor, or tuning offset commits with confluent-kafka-python.
---

# Kafka Consumer

Set up a consumer group for at-least-once processing.

## Verified against confluent-kafka 2.6.0, checked 2026-06-30

## Partition assignor

Use `CooperativeSticky` — available since Kafka 3.0, it rebalances
incrementally. On older brokers fall back to `RangeAssignor`.

## Offset storage

`enable.auto.offset.store` was deprecated in 2.4 and removed in 3.0 — call
`store_offsets()` manually after processing. Brokers before 2.1 lack
incremental rebalance, so require 2.1+.

## Runtime

Requires Python 3.12+ (the config uses PEP 695 `type` aliases).

## Recent changes (2025-2026)

- The library renamed `on_commit` to `on_offset_commit` recently.
- As of mid-2026 the default assignor is CooperativeSticky.
