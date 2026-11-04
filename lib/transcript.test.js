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

test('recognizes caption updates even when Meet recreates the DOM card', () => {
  assert.equal(require('./transcript.js').isRollingUpdate('Hello there', 'Hello there everyone'), true);
  assert.equal(require('./transcript.js').isRollingUpdate('Hello there everyone', 'Hello there'), true);
  assert.equal(require('./transcript.js').isRollingUpdate('Good morning team', 'Let us begin'), false);
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

test('merges a long cumulative caption snapshot instead of repeating the entire prefix', () => {
  const oldText = 'If a farmer has multiple plots so they can see the multiple counts in farmer services';
  const nextText = 'If a farmer has multiple plots so they can see the multiple counts in farmer services and also open the farmer profile';
  assert.equal(mergeRollingText(oldText, nextText), nextText);
  assert.equal(require('./transcript.js').isRollingUpdate(oldText, nextText), true);
});

test('replaces a long corrected caption tail instead of appending the full new snapshot', () => {
  const oldText = 'The farmer dashboard displays all available plots and services in one place for the user to review';
  const nextText = 'The farmer dashboard displays all available plots and services in one place for the farmer to review';
  assert.equal(mergeRollingText(oldText, nextText), nextText);
});

test('merges cumulative local ASR snapshots from recognizer restarts', () => {
  const { mergeRecentSpeechEntry } = require('./transcript.js');
  const entries = [];
  mergeRecentSpeechEntry(entries, {
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: 5,
    text: 'To view the most update. Untreat. This feature as soon as possible.'
  });
  const result = mergeRecentSpeechEntry(entries, {
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: 8,
    text: 'To view the most update. Please enter this feature as long as possible.'
  });
  assert.equal(result.merged, false);
  assert.equal(entries.length, 2);
});

test('keeps extending a rolling local ASR snapshot without duplicating its opening words', () => {
  const { mergeRecentSpeechEntry } = require('./transcript.js');
  const entries = [{
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: 8,
    text: 'To view the most update. Please enter this feature as long as possible.'
  }];
  mergeRecentSpeechEntry(entries, {
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: 11,
    text: 'To view the most update. Please enter this feature as long as possible. If I want it to be done as an?'
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'To view the most update. Please enter this feature as long as possible. If I want it to be done as an?');
});

test('does not merge local ASR phrases outside the short restart window', () => {
  const { mergeRecentSpeechEntry } = require('./transcript.js');
  const entries = [{
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: 2,
    text: 'To view the most update. Please enter this feature as long as possible.'
  }];
  const result = mergeRecentSpeechEntry(entries, {
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: 30,
    text: 'To view the most update. Please enter this feature as long as possible.'
  });
  assert.equal(result.merged, false);
  assert.equal(entries.length, 2);
});

test('does not merge local ASR results into Meet captions or notes', () => {
  const { mergeRecentSpeechEntry } = require('./transcript.js');
  const entries = [
    { speaker: 'Alex', source: 'meet', t: 5, text: 'To view the most update. Please enter this feature as long as possible.' },
    { speaker: 'My note', source: 'note', t: 5, text: 'To view the most update. Please enter this feature as long as possible.' }
  ];
  mergeRecentSpeechEntry(entries, {
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: 6,
    text: 'To view the most update. Please enter this feature as long as possible.'
  });
  assert.equal(entries.length, 3);
});

test('collapses the repeated cumulative speech pattern reported from a Meet recording', () => {
  const { mergeRecentSpeechEntry } = require('./transcript.js');
  const entries = [];
  const snapshots = [
    'To view the most update. Untreat. This feature as soon as possible.',
    'To view the most update. Please enter this feature as long as possible.',
    'To view the most update. Please enter this feature as long as possible. If I want it to be done as an?',
    'To view the most update. Please enter this feature as long as possible. And if I want it to be turned as?'
  ];
  snapshots.forEach((text, index) => {
    mergeRecentSpeechEntry(entries, {
      speaker: 'Meeting audio (all speakers)',
      source: 'local-asr',
      t: 5 + index * 3,
      text
    });
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[1].text, snapshots[3]);
});

test('does not merge a different sentence that shares only a short opening', () => {
  const { mergeRecentSpeechEntry } = require('./transcript.js');
  const entries = [{
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: 5,
    text: 'We need to review the plan before the meeting.'
  }];
  const result = mergeRecentSpeechEntry(entries, {
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: 7,
    text: 'We need to review a different section tomorrow.'
  });
  assert.equal(result.merged, false);
  assert.equal(entries.length, 2);
});

test('keeps a rolling local ASR segment linked across multiple restart windows', () => {
  const { mergeRecentSpeechEntry } = require('./transcript.js');
  const entries = [];
  const snapshots = [
    { t: 5, text: 'The current meeting notes are being updated continuously' },
    { t: 16, text: 'The current meeting notes are being updated continuously while people speak' },
    { t: 27, text: 'The current meeting notes are being updated continuously while people speak in the session' }
  ];
  snapshots.forEach(item => mergeRecentSpeechEntry(entries, {
    speaker: 'Meeting audio (all speakers)',
    source: 'local-asr',
    t: item.t,
    text: item.text
  }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, snapshots[2].text);
});
