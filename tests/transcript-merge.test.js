const test=require('node:test');const assert=require('node:assert/strict');const {mergeRollingText,buildTurns,formatPlainText}=require('../lib/transcript.js');
test('growing caption updates the partial sentence',()=>assert.equal(mergeRollingText('Hi Monu, what is','Hi Monu, what is your next task?'),'Hi Monu, what is your next task?'));
test('rolling windows stitch word overlap ignoring punctuation and case',()=>assert.equal(mergeRollingText('We completed the first data pipeline','first data pipeline and deployed it today.'),'We completed the first data pipeline and deployed it today.'));
test('shorter duplicates do not add words',()=>assert.equal(mergeRollingText('The deployment is complete now.','deployment is complete now'),'The deployment is complete now.'));
test('corrections are accepted inside the tail window',()=>assert.equal(mergeRollingText('We need to ship the model on Friday','We need to ship the model on Monday'),'We need to ship the model on Monday'));
test('same speaker turns merge and You is replaced',()=>assert.deepEqual(buildTurns([{speaker:'Manu',text:'Hello',t:0},{speaker:'You',text:'I am checking the pipeline.',t:1},{speaker:'You',text:'checking the pipeline and fixing the alert.',t:2}],'Angad Kumar'),[{name:'Manu',text:'Hello',t:0},{name:'Angad Kumar',text:'I am checking the pipeline and fixing the alert.',t:1}]));
test('long monologue preserves 300 incremental updates',()=>{let text='The project has a clear plan';for(let i=1;i<=300;i++){const overlap=text.split(/\s+/).slice(-4).join(' ');text=mergeRollingText(text,overlap+' decision number '+i+' was reviewed');}assert.equal((text.match(/decision number/g)||[]).length,300);assert.ok(text.includes('decision number 300 was reviewed'));});
test('plain text export puts every speaker turn in its own paragraph',()=>{
  const entries=[
    {speaker:'sharmas mulla',text:'how r u Can u Tel MI something about yourself? What are you doing? Where are you working?',t:0},
    {speaker:'Angad Kumar',text:'How r u and what is your weakness? if someone is joining later',t:12}
  ];
  assert.equal(formatPlainText(entries,'Angad Kumar'),'sharmas mulla - how r u Can u Tel MI something about yourself? What are you doing? Where are you working?\n\nAngad Kumar - How r u and what is your weakness? if someone is joining later\n');
});
test('plain text export removes accidental internal line breaks and spacing',()=>{
  assert.equal(formatPlainText([{speaker:' Speaker  One ',text:' first line\n   second   line '}]),'Speaker One - first line second line\n');
});
