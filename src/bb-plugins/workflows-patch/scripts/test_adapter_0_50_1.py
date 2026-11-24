"""Exact-cardinality 0.50.1 recipe checks with synthetic anchor fixtures."""
# ruff: noqa: PT009, PT027 - standard-library unittest suite; no pytest dependency

import unittest

from adapters import bb_0_48_1, bb_0_50_1

PROGRESS = "function C(c){x.rpc.experimental_invalidate([`runs:${c}`]),s()}"
INITIALISE = "let t=xf(x,r,A);e.onChange"
SYNTHETIC_PLUGIN = PROGRESS + INITIALISE
PLUGIN_0481 = (
    "function D(u){x.rpc.experimental_invalidate([`runs:${u}`])}let t=cv(x,A,r);e.onChange"
)
API = "  const api = {\n    internal_DO_NOT_USE_recordPluginUse() {"
CORE_ANCHORS = "\n".join(
    [
        "function buildThreadActivityStateByThreadId(deps, threads2) {",
        "    if (!backgroundActivity && !promptBannerActivity) {",
        "activeWorkflowCount: backgroundActivity?.activeWorkflowCount ?? EMPTY_THREAD_ACTIVITY.activeWorkflowCount",
        API,
        "        pendingNeedsConfiguration = null;\n      }\n    },\n    closeWebSockets()",
        "      invalidated = true;\n      rpcCaller.revoke();",
        "      publishSignal: (channel, payload) => {\n        deps.hub.notifyPluginSignal(row.id, channel, payload);\n      },",
    ]
)


class Adapter0501Tests(unittest.TestCase):
    def test_missing_or_duplicate_anchor_refuses_transformation(self):
        for anchor in (PROGRESS, INITIALISE):
            for occurrences in (0, 2):
                with self.subTest(anchor=anchor, occurrences=occurrences):
                    source = SYNTHETIC_PLUGIN.replace(anchor, anchor * occurrences)
                    with self.assertRaisesRegex(ValueError, "Expected one occurrence"):
                        bb_0_50_1.patch_activity_plugin(source)

    def test_048_1_plugin_anchors_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Expected one occurrence"):
            bb_0_50_1.patch_activity_plugin(PLUGIN_0481)

    def test_registration_queries_the_release_database_binding(self):
        # 0.50.1 binds the database to `r` and settings to `A`; 0.48.1 bound them the other way.
        old = bb_0_48_1.patch_activity_plugin(PLUGIN_0481).split("let t=cv(x,A,r);", 1)[1]
        new = bb_0_50_1.patch_activity_plugin(SYNTHETIC_PLUGIN).split("let t=xf(x,r,A);", 1)[1]
        self.assertEqual(new, old.replace("A.prepare(", "r.prepare("))
        self.assertNotIn("A.prepare(", new)

    def test_notification_precedes_stock_invalidation_and_wake(self):
        result = bb_0_50_1.patch_activity_plugin(SYNTHETIC_PLUGIN)
        self.assertLess(
            result.index("experimental_work.changed(c)"),
            result.index("x.rpc.experimental_invalidate([`runs:${c}`]),s()}"),
        )

    def test_core_exposes_work_api_before_recorded_plugin_use(self):
        result = bb_0_50_1.patch_activity_core(CORE_ANCHORS)
        self.assertIn(
            "  const api = {\n    experimental_work,\n    internal_DO_NOT_USE_recordPluginUse() {",
            result,
        )
        with self.assertRaisesRegex(ValueError, "Expected one occurrence"):
            bb_0_50_1.patch_activity_core(
                CORE_ANCHORS.replace(API, "  const api = {\n    pluginId,")
            )

    def test_session_options_leave_core_unchanged(self):
        data = b"synthetic core"
        self.assertIs(bb_0_50_1.transform("session-options", "start-server.js", data), data)

    def test_session_options_progress_metadata_uses_050_1_bindings(self):
        stock = "metadata:[a.provider,cr(a.model),a.reasoningLevel]"
        self.assertEqual(
            bb_0_50_1.patch_session_app(stock),
            "metadata:[a.provider,cr(a.model),a.reasoningLevel,...a.sessionOptionLabels]",
        )
        with self.assertRaisesRegex(ValueError, "Expected one occurrence"):
            bb_0_50_1.patch_session_app("metadata:[a.provider,fw(a.model),a.reasoningLevel]")

    def test_session_options_refuse_048_1_plugin_bindings(self):
        old = "return mp.parse({providerId:k.provider,model:Q.model,reasoningLevel:k.reasoningLevel,permissionMode:N})"
        with self.assertRaisesRegex(ValueError, "Expected one occurrence"):
            bb_0_50_1.transform(
                "session-options", "builtin-plugins/workflows/dist/server.js", old.encode()
            )

    def test_unknown_transformation_refused(self):
        with self.assertRaisesRegex(ValueError, "Unknown transformation"):
            bb_0_50_1.transform("unknown", "start-server.js", b"synthetic")


if __name__ == "__main__":
    unittest.main()
