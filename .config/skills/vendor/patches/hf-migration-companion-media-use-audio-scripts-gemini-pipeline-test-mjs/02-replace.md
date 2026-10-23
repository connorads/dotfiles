const path = require('node:path');
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 2), ['transcribe', '${voicePath}']);
assert.ok(fs.existsSync(args[1]));
assert.equal(args[args.indexOf('--model')+1], 'small.en');
fs.writeFileSync(path.join(args[args.indexOf('--dir')+1], 'transcript.json'), JSON.stringify([
