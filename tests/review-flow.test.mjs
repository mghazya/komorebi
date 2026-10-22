import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildQuizQueue,feedbackSummary,hintBanners,toggleReviewWrapUp} from '../quiz.mjs';
import {scorePlacement} from '../engine.mjs';
const app=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
function fn(name){const start=app.indexOf(`function ${name}(`);assert.ok(start>=0);const tail=app.slice(start);const end=name==='renderSession'?tail.search(/\n(async\s+)?function submitAnswer/):tail.indexOf('\nfunction ',1);return end<0?tail:tail.slice(0,end);}
import {KANJI_READINGS} from '../kanji-readings.mjs';
const item={id:'kanji:test',type:'kanji',character:'去',meaning:'Past',meanings:['Past'],readings:['きょ','こ'],otherReadings:['さ'],meaningMnemonic:'meaning-story',readingMnemonic:'reading-story',sentences:[{japanese:'context-secret',english:'context-translation'}]};
function renderer(kind,remaining,feedback={correct:true,answer:'answer'}){
 const session={phase:'quiz',mode:'placement',selected:[item],finished:[],queue:[{id:item.id,kind},...remaining],totalQuestions:2,infoOpen:true,feedback};
 const c=vm.createContext({session,getItem:()=>item,feedbackSummary,hintBanners,esc:String,readingsOf:i=>i.readings,icon:()=>'',glyph:i=>i.character,charLenClass:i=>'char-len-1',KANJI_READINGS,renderKanjiReadings:(it)=>{
  const d=KANJI_READINGS[it.character];
  return `<div class="kanji-readings-grid"><div class="reading-column is-primary"><span class="reading-column-title">On’yomi</span><p class="reading-column-items">${d.onyomi.join(', ')}</p></div><div class="reading-column"><span class="reading-column-title">Kun’yomi</span><p class="reading-column-items">${d.kunyomi.join(', ')}</p></div><div class="reading-column"><span class="reading-column-title">Nanori</span><p class="reading-column-items is-none">None</p></div></div>`;
 }});
 vm.runInContext(fn('renderSession'),c);
 return {c,html:()=>vm.runInContext('renderSession()',c)};
}
for(const kind of ['meaning','reading'])for(const correct of [true,false]){
 test(`Item info is available after answering: ${kind}, correct=${correct}`,()=>{
  const other=kind==='meaning'?'reading':'meaning';
  const {html}=renderer(kind,[{id:item.id,kind:other}],{correct,answer:'answer'});
  assert.match(html(),/Item Info/);
  assert.match(html(),/meaning-story/);
  assert.match(html(),/reading-story/);
  assert.match(html(),/On’yomi/);
  assert.match(html(),/Kun’yomi/);
  assert.match(html(),/Nanori/);
 });
}
test('Full item info remains available after all queue parts tested',()=>{
 const {html}=renderer('reading',[]);assert.match(html(),/Item Info/);assert.match(html(),/meaning-story/);assert.match(html(),/reading-story/);
});
test('Retry does not expose item info',()=>{
 const {html}=renderer('reading',[],{retry:true,answer:'other'});assert.doesNotMatch(html(),/Item Info|reading-story/);
});
test('Hint banner rendered as interactive button with toggle-info action',()=>{
 const multiItem = { ...item, meanings: ['Past', 'Previous'] };
 const session={phase:'quiz',mode:'placement',selected:[multiItem],finished:[],queue:[{id:multiItem.id,kind:'meaning'}],totalQuestions:1,infoOpen:false,feedback:{correct:true,answer:'Past'}};
 const c=vm.createContext({session,getItem:()=>multiItem,feedbackSummary,hintBanners,esc:String,readingsOf:i=>i.readings,icon:()=>'',glyph:i=>i.character,charLenClass:i=>'char-len-1',KANJI_READINGS,renderKanjiReadings:()=>''});
 vm.runInContext(fn('renderSession'),c);
 const html = vm.runInContext('renderSession()',c);
 assert.match(html, /class="hint-banner"[^>]*data-action="toggle-info"/);
 assert.match(html, /Did you know this item has multiple possible meanings\?/);
});
test('Kanji readings dataset accurately maps On’yomi, Kun’yomi, and Nanori for sample kanji',()=>{
 assert.deepEqual(KANJI_READINGS['去'], { onyomi: ['きょ', 'こ'], kunyomi: ['さ'], nanori: [], primaryType: 'onyomi' });
 assert.deepEqual(KANJI_READINGS['一'], { onyomi: ['いち', 'いつ'], kunyomi: ['ひと'], nanori: ['かず'], primaryType: 'onyomi' });
 assert.deepEqual(KANJI_READINGS['川'], { onyomi: ['せん'], kunyomi: ['かわ'], nanori: [], primaryType: 'kunyomi' });
 assert.deepEqual(KANJI_READINGS['輔'], { onyomi: ['ふ', 'ほ'], kunyomi: ['たす'], nanori: ['すけ'], primaryType: 'nanori' });
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

test('Security: Hardcoded PII and backdoor logic are removed from app.mjs', () => {
 assert.doesNotMatch(app, /danargading/i, 'Personal email must not be hardcoded in app.mjs');
 assert.doesNotMatch(app, /ensureAccountBaseline/, 'Account baseline backdoor must not exist');
 assert.doesNotMatch(app, /window\.__komorebi/, 'Debug internal state must not be exposed on window');
});

test('Security: safeHref properly sanitizes URLs and prevents javascript: XSS', () => {
 const m = app.match(/const safeHref\s*=\s*(url\s*=>\s*\{[\s\S]*?\n\};)/);
 assert.ok(m, 'safeHref function definition must exist');
 const c = vm.createContext({ window: { location: { origin: 'https://komorebi.app' } }, URL });
 const safeHref = vm.runInContext(`(${m[1].replace(/;$/, '')})`, c);

 assert.equal(safeHref('https://www.wanikani.com/kanji/%E5%8E%BB'), 'https://www.wanikani.com/kanji/%E5%8E%BB');
 assert.equal(safeHref('http://example.com/test'), 'http://example.com/test');
 assert.equal(safeHref('javascript:alert(document.cookie)'), '');
 assert.equal(safeHref('data:text/html,<script>alert(1)</script>'), '');
 assert.equal(safeHref('vbscript:msgbox(1)'), '');
 assert.equal(safeHref(''), '');
 assert.equal(safeHref(null), '');
 assert.equal(safeHref(undefined), '');
});

test('Security: index.html has Content-Security-Policy and Referrer-Policy', () => {
 const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
 assert.match(html, /<meta\s+http-equiv=["']Content-Security-Policy["']/i);
 assert.match(html, /<meta\s+name=["']referrer["']\s+content=["']strict-origin-when-cross-origin["']/i);
});

test('Dashboard: subject-grid receives is-vocabulary class when filter is vocabulary', () => {
 assert.match(app, /class="subject-grid\s+\$\{filter==='vocabulary'\?'is-vocabulary':''\}"/, 'subject-grid must conditionally receive is-vocabulary class');

 const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
 assert.match(css, /\.subject-grid\.is-vocabulary\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s, 'is-vocabulary must use flex-wrap');
 assert.match(css, /\.subject-tile\.vocabulary\s*\{[^}]*width:\s*auto\s*!important;[^}]*white-space:\s*nowrap;/s, 'vocabulary tile must have auto-width and nowrap');
});

