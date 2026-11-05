import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {checkAnswer,subjectKindLabel,meaningPrompt,meaningSubtext,answerInputLabel,readingPrompt,readingTypeLabel,toHiragana} from '../engine.mjs';
import {KANJI_READINGS} from '../kanji-readings.mjs';
import {feedbackSummary,hintBanners} from '../quiz.mjs';
const subjects=Array.from({length:60},(_,n)=>JSON.parse(fs.readFileSync(new URL(`../data/level-${n+1}.json`,import.meta.url)))).flat();
const kanji=c=>subjects.find(i=>i.type==='kanji'&&i.character===c);
const radical=id=>subjects.find(i=>i.id===id);
const vocab=c=>subjects.find(i=>i.type==='vocabulary'&&i.character===c);
test('Prompts distinguish on, kun, name and vocabulary readings',()=>{
 assert.match(readingPrompt(kanji('山')),/on’yomi/);
 assert.match(readingPrompt(kanji('川')),/kun’yomi/);
 assert.match(readingPrompt(kanji('叔')),/nanori/);
 assert.equal(readingPrompt({type:'vocabulary',character:'山',readings:['やま']}),'How do you read this word?');
 assert.equal(readingTypeLabel({type:'kanji',character:'?',readings:['あ']}),'');
});
test('Meaning prompts, visible labels, and accessible input labels distinguish radical, kanji, and vocabulary before answering',()=>{
 const rTen = radical('radical:cross');
 const kTen = kanji('十');
 const vTen = vocab('十');
 assert.equal(subjectKindLabel(rTen, 'meaning'), 'Radical · Meaning');
 assert.equal(subjectKindLabel(kTen, 'meaning'), 'Kanji · Meaning');
 assert.equal(subjectKindLabel(vTen, 'meaning'), 'Vocabulary · Meaning');
 assert.equal(subjectKindLabel(kTen, 'reading'), 'Kanji · Reading');
 assert.equal(subjectKindLabel(vTen, 'reading'), 'Vocabulary · Reading');

 assert.equal(meaningPrompt(rTen), 'What is this radical’s name?');
 assert.equal(meaningPrompt(kTen), 'What does this kanji mean?');
 assert.equal(meaningPrompt(vTen), 'What does this word mean?');

 assert.match(answerInputLabel(rTen, 'meaning'), /Radical · Meaning/);
 assert.match(answerInputLabel(rTen, 'meaning'), /What is this radical’s name\?/);
 assert.match(answerInputLabel(kTen, 'meaning'), /Kanji · Meaning/);
 assert.match(answerInputLabel(kTen, 'meaning'), /What does this kanji mean\?/);
 assert.match(answerInputLabel(vTen, 'meaning'), /Vocabulary · Meaning/);
 assert.match(answerInputLabel(vTen, 'meaning'), /What does this word mean\?/);
 assert.match(answerInputLabel(kTen, 'reading'), /Kanji · Reading.*on’yomi/);
 assert.match(answerInputLabel(vTen, 'reading'), /Vocabulary · Reading.*How do you read this word\?/);

 // Render the three Level 1 十 cards before answering and verify visible labels and no early answer leak
 const app=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 const start=app.indexOf('function renderSession(');
 const tail=app.slice(start);
 const renderCode=tail.slice(0,tail.search(/\n(async\s+)?function submitAnswer/));
 for (const [it, expectedKind, expectedPrompt, forbiddenAnswer] of [
  [rTen, 'Radical · Meaning', 'What is this radical’s name?', 'Cross'],
  [kTen, 'Kanji · Meaning', 'What does this kanji mean?', 'Ten'],
  [vTen, 'Vocabulary · Meaning', 'What does this word mean?', 'Ten'],
 ]) {
  const session={phase:'quiz',mode:'practice',selected:[it],finished:[],queue:[{id:it.id,kind:'meaning'}],totalQuestions:1,infoOpen:false,feedback:null};
  const c=vm.createContext({session,getItem:()=>it,subjectKindLabel,meaningPrompt,meaningSubtext,answerInputLabel,readingPrompt,readingTypeLabel,feedbackSummary,hintBanners,esc:String,readingsOf:i=>i.readings,icon:()=>'',glyph:i=>i.character,charLenClass:()=>'char-len-1',KANJI_READINGS,renderKanjiReadings:()=>''});
  vm.runInContext(renderCode,c);
  const html=vm.runInContext('renderSession()',c);
  assert.match(html, new RegExp(`<span class="subject-kind">${expectedKind}</span>`));
  assert.match(html, new RegExp(`<h1>${expectedPrompt.replace('?','\\?')}</h1>`));
  const textOnly = html.replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(textOnly, new RegExp(`\\b${forbiddenAnswer}\\b`, 'i'), `${it.id} must not reveal ${forbiddenAnswer} before answering`);
 }

 // Grader behavior unchanged for the three Level 1 十 cards
 assert.equal(checkAnswer(rTen, 'meaning', 'Cross').correct, true);
 assert.equal(checkAnswer(rTen, 'meaning', 'Ten').correct, false);
 assert.equal(checkAnswer(kTen, 'meaning', 'Ten').correct, true);
 assert.equal(checkAnswer(kTen, 'meaning', 'Cross').correct, false);
 assert.equal(checkAnswer(vTen, 'meaning', 'Ten').correct, true);
 assert.equal(checkAnswer(vTen, 'meaning', 'Cross').correct, false);
});
test('Known alternatives retry; taught readings pass; unrelated answers fail',()=>{
 for(const [c,answer,expectedType] of [['山','yama','on’yomi'],['川','セン','kun’yomi'],['叔','shuku','nanori (name reading)'],['玉','gyoku','kun’yomi'],['一','かず','on’yomi']]) {
  const r=checkAnswer(kanji(c),'reading',answer);
  assert.equal(r.retry,true,c);
  assert.equal(r.message,`We’re looking for the ${expectedType} reading. No mistake counted.`);
 }
 assert.equal(checkAnswer(kanji('山'),'reading','san').correct,true);
 assert.equal(checkAnswer(kanji('川'),'reading','kawa').correct,true);
 assert.equal(checkAnswer(kanji('叔'),'reading','o').correct,true);
 assert.equal(checkAnswer(kanji('山'),'reading','ねこ').retry,undefined);
 assert.equal(checkAnswer({type:'vocabulary',character:'山',readings:['やま']},'reading','さん').retry,undefined);
 assert.equal(checkAnswer({type:'vocabulary',character:'山',readings:['やま']},'reading','さん').correct,false);
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
