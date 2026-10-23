const path = require('node:path');
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 3), ['hyperframes', 'transcribe', '${voicePath}']);
assert.ok(fs.existsSync(args[2]));
assert.equal(args[args.indexOf('--model')+1], 'small.en');
fs.writeFileSync(path.join(args[args.indexOf('--dir')+1], 'transcript.json'), JSON.stringify([
