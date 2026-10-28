import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {checkAnswer,readingPrompt,readingTypeLabel,toHiragana} from '../engine.mjs';
import {KANJI_READINGS} from '../kanji-readings.mjs';
const subjects=Array.from({length:60},(_,n)=>JSON.parse(fs.readFileSync(new URL(`../data/level-${n+1}.json`,import.meta.url)))).flat();
const kanji=c=>subjects.find(i=>i.type==='kanji'&&i.character===c);
test('Prompts distinguish on, kun, name and vocabulary readings',()=>{
 assert.match(readingPrompt(kanji('山')),/on’yomi/);
 assert.match(readingPrompt(kanji('川')),/kun’yomi/);
 assert.match(readingPrompt(kanji('叔')),/nanori/);
 assert.equal(readingPrompt({type:'vocabulary',character:'山',readings:['やま']}),'How do you read this word?');
 assert.equal(readingTypeLabel({type:'kanji',character:'?',readings:['あ']}),'');
});
test('Known alternatives retry; taught readings pass; unrelated answers fail',()=>{
 for(const [c,answer] of [['山','yama'],['川','セン'],['玉','gyoku'],['一','かず']]) {
  const r=checkAnswer(kanji(c),'reading',answer);assert.equal(r.retry,true,c);assert.match(r.message,/No mistake counted/);
 }
 assert.equal(checkAnswer(kanji('山'),'reading','san').correct,true);
 assert.equal(checkAnswer(kanji('山'),'reading','ねこ').retry,undefined);
 assert.equal(checkAnswer({type:'vocabulary',character:'山',readings:['やま']},'reading','さん').retry,undefined);
});
test('All taught course readings remain accepted and every mapped alternative permits retry',()=>{
 for(const i of subjects.filter(i=>i.type==='kanji')){
  assert.ok(readingTypeLabel(i),i.character+' needs a reading type');
  for(const r of i.readings) assert.equal(checkAnswer(i,'reading',r).correct,true,`${i.character}:${r}`);
  const data=KANJI_READINGS[i.character];
  for(const r of [...(data?.onyomi||[]),...(data?.kunyomi||[]),...(data?.nanori||[])]){
   const result=checkAnswer(i,'reading',r);assert.ok(result.correct||result.retry,`${i.character}:${r}`);
  }
 }
});
test('Actual submit handler leaves scores, placement answers and progress untouched on retry',async()=>{
 const app=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const code=app.slice(app.indexOf('async function submitAnswer('),app.indexOf('async function continueAnswer('));
 for(const mode of ['review','lesson','practice','placement']){
  const item=kanji('一');const session={phase:'quiz',mode,queue:[{id:item.id,kind:'reading'}],answers:2,correct:1,mistakes:{},placementAnswers:[],finished:[]};
  const input={value:'kazu'};
  const c=vm.createContext({session,getItem:()=>item,$:()=>input,toHiragana,checkAnswer,render:()=>{},requestAnimationFrame:()=>{},updateProfile:()=>assert.fail('retry must not save progress')});
  vm.runInContext(code,c);await vm.runInContext('submitAnswer()',c);
  assert.equal(session.feedback.retry,true);assert.equal(session.answers,2);assert.equal(session.correct,1);assert.deepEqual(session.mistakes,{});assert.deepEqual(session.placementAnswers,[]);assert.equal(session.queue.length,1);
 }
});
