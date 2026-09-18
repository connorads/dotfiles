const audioStream = await client.textToSpeech.convert("selected_voice_id", {
  text: "Streaming audio in JavaScript.",
  modelId: "eleven_flash_v2_5",
});
