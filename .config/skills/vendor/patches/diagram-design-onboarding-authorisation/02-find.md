## Final step — user verifies the output

After applying the tokens and handling the profile choice, generate or rebuild a representative output document. If onboarding is part of a diagram request, use that requested output; otherwise use one representative example. Provide its local path and task the user explicitly:

> *"Please open `<output-path>` and verify the palette, typography, contrast, and overall rendering. Reply `approved` or tell me what should change."*

Automated checks do not replace this review. Leave onboarding marked **pending user verification** until the user explicitly confirms the output document. If the user requests corrections, apply them, rebuild the output document, provide its local path, and ask for approval again.
