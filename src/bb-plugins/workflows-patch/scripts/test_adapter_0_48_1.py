"""Exact-cardinality 0.48.1 recipe checks with synthetic anchor fixtures."""
# ruff: noqa: PT009, PT027 - standard-library unittest suite; no pytest dependency

import unittest

from adapters import bb_0_47_1, bb_0_48_1

PROGRESS = "function D(u){x.rpc.experimental_invalidate([`runs:${u}`])}"
INITIALISE = "let t=cv(x,A,r);e.onChange"
SYNTHETIC_PLUGIN = PROGRESS + INITIALISE


class Adapter0481Tests(unittest.TestCase):
    def test_missing_or_duplicate_anchor_refuses_transformation(self):
        for anchor in (PROGRESS, INITIALISE):
            for occurrences in (0, 2):
                with self.subTest(anchor=anchor, occurrences=occurrences):
                    source = SYNTHETIC_PLUGIN.replace(anchor, anchor * occurrences)
                    with self.assertRaisesRegex(ValueError, "Expected one occurrence"):
                        bb_0_48_1.patch_activity_plugin(source)

    def test_old_plugin_anchors_are_rejected(self):
        for source in (
            SYNTHETIC_PLUGIN.replace(
                PROGRESS, "function D(u){x.realtime.publish(_a,{threadId:u})}"
            ),
            SYNTHETIC_PLUGIN.replace(INITIALISE, "let t=pv(x,A,r);e.onChange"),
        ):
            with self.subTest(source=source), self.assertRaises(ValueError):
                bb_0_48_1.patch_activity_plugin(source)

    def test_registration_matches_pinned_adapter_verbatim(self):
        old = "function D(u){x.realtime.publish(_a,{threadId:u})}let t=pv(x,A,r);e.onChange"
        old_result = bb_0_47_1.patch_activity_plugin(old)
        new_result = bb_0_48_1.patch_activity_plugin(SYNTHETIC_PLUGIN)
        self.assertEqual(
            old_result.split("let t=pv(x,A,r);", 1)[1],
            new_result.split("let t=cv(x,A,r);", 1)[1],
        )

    def test_notification_precedes_stock_rpc_invalidation(self):
        result = bb_0_48_1.patch_activity_plugin(SYNTHETIC_PLUGIN)
        self.assertLess(
            result.index("experimental_work.changed(u)"),
            result.index("rpc.experimental_invalidate"),
        )
        self.assertEqual(result.count("x.rpc.experimental_invalidate([`runs:${u}`])"), 1)

    def test_session_options_leave_core_unchanged(self):
        data = b"synthetic core"
        self.assertIs(bb_0_48_1.transform("session-options", "start-server.js", data), data)

    def test_session_options_progress_metadata_uses_048_1_bindings(self):
        stock = "metadata:[a.provider,fw(a.model),a.reasoningLevel]"
        self.assertEqual(
            bb_0_48_1.patch_session_app(stock),
            "metadata:[a.provider,fw(a.model),a.reasoningLevel,...a.sessionOptionLabels]",
        )
        with self.assertRaisesRegex(ValueError, "Expected one occurrence"):
            bb_0_48_1.patch_session_app("metadata:[i.provider,$n(i.model),i.reasoningLevel]")

    def test_session_options_refuse_047_1_plugin_bindings(self):
        old = "return kp.parse({providerId:k.provider,model:Q.model,reasoningLevel:k.reasoningLevel,permissionMode:N})"
        with self.assertRaisesRegex(ValueError, "Expected one occurrence"):
            bb_0_48_1.transform(
                "session-options", "builtin-plugins/workflows/dist/server.js", old.encode()
            )

    def test_unknown_transformation_refused(self):
        with self.assertRaisesRegex(ValueError, "Unknown transformation"):
            bb_0_48_1.transform("unknown", "start-server.js", b"synthetic")


if __name__ == "__main__":
    unittest.main()
