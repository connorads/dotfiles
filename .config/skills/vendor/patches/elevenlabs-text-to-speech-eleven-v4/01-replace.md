## Eleven v4

{{marker}}

`eleven_v4` is the highest-quality expressive model; `eleven_v4_turbo` is its real-time variant (~100ms). Neither is a default, so always pass `model_id`. See [Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4) and the [prompting guide](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v4).

- **Endpoints**: ElevenLabs routes `eleven_v4` through Text to Dialogue (`client.text_to_dialogue.convert`, `inputs[]` of `{text, voice_id}`), which reads the whole scene so speakers react to each other. Create speech also accepts it for a single voice. `eleven_v4_turbo` streams through the Text to Dialogue WebSocket with one registered voice (`eleven_v4` allows 10): send `new_turn: true` at turn ends, `flush` to skip the ~40-character buffer, and `keep_alive` within the 20s idle timeout. The TTS `stream-input` WebSocket rejects v3 and v4.
- **Limits**: 10,000 characters per `eleven_v4` speech request. Keep Text to Dialogue requests to 2,000 characters of total `inputs[].text` and concatenate the chunks.
- **Settings**: only stability and similarity apply; lower stability varies delivery more. Text to Dialogue takes `settings.stability` and `settings.similarity`. Style, speed and SSML (including `<break>`) have no effect, yet requests carrying them or a misnamed field still succeed, so a wrong setting fails silently.
- **Tags**: free-form bracketed directions placed where delivery should change: `[whispers]`, `[sighs]`, `[sarcastic]`, `[Quiet, measured narration]`. Sound effects such as `[applause]` also render, so describe voice quality explicitly (`[low, gravelly voice]`) or a vague tag may come out as a sound. Match tags to the voice's character.
- **Tagging a script** (the rules of ElevenLabs' Enhance prompt): tag only sounds the voice makes; never change, add or remove words; put a tag just before or after the line it modifies; add emphasis only with CAPS, `?`, `!` or `...`.
- **Pacing and pronunciation**: ellipses add pauses and weight; CAPS add emphasis. For pronunciation, write IPA between slashes inside quotes, e.g. `"/ˌbaɪoʊˈkemɪstri/"`, with stress marks. Phoneme tags do not work on v4.
- **Dialogue**: end an interrupted line with a dash and open the next turn with `[jumping in]`.
- **Takes**: output varies and `seed` is best-effort. Generate several takes of anything user-facing and let the user choose.
- **Voices**: v4 clones reproduce the source recording, flaws included, and can sound unlike their v3 rendering. Voice Design voices may be less performative. A voice speaking another language takes that language's native accent; use `eleven_v3` when the source accent must carry, and `eleven_multilingual_v2` when style or speed control is required.

## Voice IDs

Use pre-made voices or custom voices from the dashboard, and preview a voice on the target model before casting it.
