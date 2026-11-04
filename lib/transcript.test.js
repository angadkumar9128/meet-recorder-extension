const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeRollingText, buildTurns, formatPlainText } = require('./transcript.js');

test('extends a rolling caption without repeating its prefix', () => {
  assert.equal(mergeRollingText('Hello there', 'Hello there everyone'), 'Hello there everyone');
});

test('replaces a corrected rolling tail instead of preserving the wrong words', () => {
  assert.equal(mergeRollingText('I think we should go', 'I think we could go'), 'I think we could go');
});

test('joins a new caption with its overlapping tail only once', () => {
  assert.equal(mergeRollingText('we should go now', 'go now because it is late'), 'we should go now because it is late');
});

test('does not duplicate an identical caption', () => {
  assert.equal(mergeRollingText('The meeting starts now', 'The meeting starts now'), 'The meeting starts now');
});

test('preserves a genuinely new phrase', () => {
  assert.equal(mergeRollingText('Good morning team', 'Let us begin'), 'Good morning team Let us begin');
});

test('builds a clean same-speaker turn from rolling caption snapshots', () => {
  const turns = buildTurns([
    { speaker: 'Alex', text: 'We need to review the report' },
    { speaker: 'Alex', text: 'We need to review the report today' },
    { speaker: 'Sam', text: 'I agree' },
    { speaker: 'Alex', text: 'I will share the link' }
  ]);
  assert.deepEqual(turns, [
    { name: 'Alex', text: 'We need to review the report today', t: 0 },
    { name: 'Sam', text: 'I agree', t: 0 },
    { name: 'Alex', text: 'I will share the link', t: 0 }
  ]);
});

test('plain text export contains no repeated rolling prefix', () => {
  const output = formatPlainText([
    { speaker: 'Alex', text: 'The next step is testing' },
    { speaker: 'Alex', text: 'The next step is testing the changes' }
  ]);
  assert.equal(output, 'Alex - The next step is testing the changes\n');
});
