} from "./tts.mjs";

// Exercise managed CLI launches with injected platforms and child processes.
function fakeSpawn(captured) {
  return (cmd, args, opts) => {
