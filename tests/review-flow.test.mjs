import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildQuizQueue,feedbackSummary,hintBanners,toggleReviewWrapUp} from '../quiz.mjs';
import {scorePlacement} from '../engine.mjs';
const app=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
function fn(name){const start=app.indexOf(`function ${name}(`);assert.ok(start>=0);const tail=app.slice(start);const end=name==='renderSession'?tail.indexOf('\nfunction submitAnswer'):tail.indexOf('\nfunction ',1);return end<0?tail:tail.slice(0,end);}
const item={id:'kanji:test',type:'kanji',character:'字',meaning:'Letter',meanings:['Letter'],readings:['じ'],meaningMnemonic:'meaning-story',readingMnemonic:'reading-story',sentences:[{japanese:'context-secret',english:'context-translation'}]};
function renderer(kind,remaining,feedback={correct:true,answer:'answer'}){
 const session={phase:'quiz',mode:'placement',selected:[item],finished:[],queue:[{id:item.id,kind},...remaining],totalQuestions:2,infoOpen:true,feedback};
 const c=vm.createContext({session,getItem:()=>item,feedbackSummary,hintBanners,esc:String,readingsOf:i=>i.readings,icon:()=>'',glyph:i=>i.character});
 vm.runInContext(fn('renderSession'),c);
 return {c,html:()=>vm.runInContext('renderSession()',c)};
}
for(const kind of ['meaning','reading'])for(const correct of [true,false]){
 test(`Info and stories stay hidden with another part pending: ${kind}, correct=${correct}`,()=>{
  const other=kind==='meaning'?'reading':'meaning';
  const {html}=renderer(kind,[{id:item.id,kind:other}],{correct,answer:'answer'});
  assert.doesNotMatch(html(),/Item Info|meaning-story|reading-story|context-secret/);
 });
}
test('Full item info remains available after both parts have been tested',()=>{
 const {html}=renderer('reading',[]);assert.match(html(),/Item Info/);assert.match(html(),/meaning-story/);assert.match(html(),/reading-story/);
});
test('Retry does not expose item info',()=>{
 const {html}=renderer('reading',[],{retry:true,answer:'other'});assert.doesNotMatch(html(),/Item Info|reading-story/);
});
test('Wrap up preserves all unstarted subjects and can be cancelled repeatedly',()=>{
 const selected=Array.from({length:25},(_,n)=>({id:String(n)}));
 const s={mode:'review',phase:'quiz',selected:[...selected],unstarted:selected.slice(10),queue:[{id:'0',kind:'meaning'}],finished:[],wrappingUp:false};
 for(let n=0;n<3;n++){
  toggleReviewWrapUp(s);assert.equal(s.selected.length,10);assert.equal(s.unstarted.length,0);assert.equal(s.wrappingUp,true);
  toggleReviewWrapUp(s);assert.deepEqual(s.selected,selected);assert.deepEqual(s.unstarted,selected.slice(10));
 }
 assert.deepEqual(s.queue,[{id:'0',kind:'meaning'}]);assert.deepEqual(s.finished,[]);
});
test('Milestone dismissal preserves the input node, draft and focus without rendering',()=>{
 const input={value:'partially typed',focused:true};let removed=0,cleared=0;
 const session={levelUpEvent:{},levelUpTimer:7};
 const c=vm.createContext({session,clearTimeout:()=>cleared++,$:selector=>selector==='.levelup-tooltip'?{remove:()=>removed++}:input,render:()=>assert.fail('must not redraw')});
 vm.runInContext(fn('dismissLevelUp'),c);vm.runInContext('dismissLevelUp()',c);
 assert.equal(removed,1);assert.equal(cleared,1);assert.equal(input.value,'partially typed');assert.equal(input.focused,true);
 assert.match(app,/if \(session === s && session.levelUpEvent\) dismissLevelUp\(\)/);
});
test('Wrap-up redraw preserves the current input and cursor',()=>{
 let input={value:'にほn',selectionStart:3,selectionEnd:3,disabled:false};let focused=false;
 const c=vm.createContext({$:()=>input,render:()=>{input={value:'',disabled:false,focus:()=>focused=true,setSelectionRange:(a,b)=>{input.selectionStart=a;input.selectionEnd=b;}};}});
 vm.runInContext(fn('renderPreservingAnswer'),c);vm.runInContext('renderPreservingAnswer()',c);
 assert.equal(input.value,'にほn');assert.equal(input.selectionStart,3);assert.ok(focused);
});
test('Random queues retain all parts and placement never grants an incomplete subject',()=>{
 const items=Array.from({length:15},(_,n)=>({...item,id:String(n)}));
 const expected=items.flatMap(i=>['meaning','reading'].map(kind=>`${i.id}:${kind}`)).sort();
 for(let run=0;run<100;run++){
  const queue=buildQuizQueue(items);assert.deepEqual(queue.map(q=>`${q.id}:${q.kind}`).sort(),expected);
  for(let count=1;count<queue.length;count++){
   const answers=queue.slice(0,count).map(q=>({...q,correct:true}));
   const score=scorePlacement(answers,{expected:queue});
   for(const id of score.grantIds)assert.ok(['meaning','reading'].every(kind=>answers.some(q=>q.id===id&&q.kind===kind)));
  }
 }
});
