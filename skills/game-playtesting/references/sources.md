# Sources and limits

The workflow is a synthesis. These sources support particular methods; none
establishes the performance of a coding agent using this skill.

## Selected book passages

| Source | Passages | Contribution and boundary |
| --- | --- | --- |
| Michael Sellers, *Advanced Game Design: A Systems Approach* | Ch. 12, pp. 387-400; especially pp. 387-389, 392, 396-399 | Interactive intention/action/state/feedback; a test question distinct from the player goal; directed play and exploration. Sellers distinguishes human design playtesting from bug finding. Agent QA does not inherit human comprehension evidence. |
| Steve Swink, *Game Feel* | Ch. 5, pp. 82-84; ch. 7, pp. 121-126; ch. 8, pp. 145-149; ch. 17, pp. 298-308 | Align input, state and visible events; distinguish response onset from completion; investigate control ambiguity, staging and geometry. The examples do not establish universal latency thresholds. |
| Nicholas Lovell, *The Pyramid of Game Design* | Ch. 11, pp. 185-186 and 190-194 | Components must work together; experiments answer predictions and consequential uncertainties. Retention and service-game assumptions do not become requirements for this skill. |

## Automated testing and agent control

- [EA production testing](https://arxiv.org/html/2307.11105v1) combines scripted
  objectives with trained locomotion policies. Accelerated simulation caused
  parked helicopters to fall through the ground. This motivates recording the
  timing regime and confirming physics findings under intended conditions.
- [EA curiosity-driven exploration](https://arxiv.org/html/2103.13798v2) records
  trajectories and explores from visited grounded positions. Its
  trained agents use privileged state. Spatial exploration is not proof of a
  connected quest or screenshot-agent capability.
- [Inspector](https://arxiv.org/html/2207.08379v1) combines trained exploration,
  object detection and investigation. It reaches potential clipping defects;
  its conclusion leaves screenshot-based bug detection and more complex
  multi-room prerequisites to future work.
- [Cradle, appendix B.2.1](https://arxiv.org/html/2403.03186v1#A2.SS2.SSS1)
  describes pausing RDR2 during model reasoning and resetting input disrupted
  by pause/resume. This supports distinguishing controller latency from game
  behaviour, not prescribing pauses in every test.
- [OpenAI game-playtest](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/game-playtest/SKILL.md)
  provides browser, camera, pointer-lock and visual-review checks. It is useful
  procedural guidance, not a measured evaluation of connected progression.
- [Playwright keyboard](https://playwright.dev/docs/api/class-keyboard) and
  [Trace Viewer](https://playwright.dev/docs/trace-viewer) document input and
  evidence capabilities. Traces alone do not guarantee deterministic game replay.

The distinction between control, information and timing assistance is this
skill's organising method. The wall-contact example is an investigation recipe,
not a reported successful human playtest.
