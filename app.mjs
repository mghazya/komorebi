import { STAGE_NAMES, newProfile, availableLessons, dueReviews, startLearning, completeReview, statusFor, stats, toHiragana, checkAnswer, matchesSearch, practicePool, viewFromHash, intervalFor, learnerLevel, levelProgress, recordLevelUnlock, hasPassed, markAsGuru, markAsGuruMany, selectPlacementSample, scorePlacement, graduateLevelCandidates, GURU_STAGE, PLACEMENT_SAMPLE_SIZE, placementShouldFinish } from './engine.mjs?v=20261009-placement-fixes';
import { validateProfile as checkProfile, batchSizeOf, unknownProgressIds, serializeBackup } from './profile.mjs?v=20261009-placement-fixes';
import { loadCurriculum, sanitizeSvg, svgDataUrl, isSafeImagePath } from './curriculum.mjs?v=20261009-placement-fixes';
import { buildQuizQueue, feedbackSummary } from './quiz.mjs?v=20261009-placement-fixes';
import { createCloudSync } from './sync.mjs?v=20261009-placement-fixes';

import { createCloudClient, AUTH_STORAGE_KEY, validateNewPassword, validatePasswordChange, MIN_PASSWORD_LENGTH } from './cloud.mjs?v=20261009-placement-fixes';
import { CLOUD_CONFIG } from './config.js?v=20261009-placement-fixes';
const cloud = createCloudClient(CLOUD_CONFIG);
let busy = false;
// Account-scoped cloud state lives in the sync controller (REVIEW P1): it resets on every account change.
const sync = createCloudSync({ cloud, validate: (value) => validateProfile(value), emptyProfile: (user) => newProfile(user.email?.split('@')[0] || 'Learner', user.id), hooks: {
 setBusy: (value, message) => setBusy(value, message), isBusy: () => busy, onChange: () => { if (state) render(); },
 onSaveError: () => { session = null; render(); toast('Progress needs your attention before you continue.'); },
 onDraftError: () => toast('Unsynced progress could not be backed up on this device. Export it before closing.'),
} });
const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'komorebi.study.v1';
const TYPES = { radical: 'Radicals', kanji: 'Kanji', vocabulary: 'Vocabulary' };
const icons = {
 home:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 book:'<path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v15"/>',
 leaf:'<path d="M19 3C7 1 2 8 5 15s16 7 14-12ZM5 21 16 8M9 16l-1-6m5 2 5 1"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 check:'<path d="m5 12 4 4L19 6"/>', lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
 chevron:'<path d="m8 5 7 7-7 7"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>', download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>', back:'<path d="M20 12H4m6-6-6 6 6 6"/>', play:'<path d="m8 4 12 8-12 8Z"/>', people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m2 11v-4a6 6 0 0 0-2-4"/>', plus:'<path d="M12 4v16M4 12h16"/>'
};
const icon = (name, extra='') => `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.leaf}</svg>`;
let items = [], itemsById = new Map(), curriculum = null, state, savedRaw = null, storageOK = true, view = 'dashboard', filter = 'radical', search = '', session = null, toastTimer;
let libraryLevel = null, libraryPage = 0;
const LIBRARY_PAGE_SIZE = 48;
const images = new Map(); // sanitized radical SVGs: path -> data URL (null when unavailable)
const guestProfile = () => state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
const profile = () => sync.state.profile || guestProfile();
const getItem = id => itemsById.get(id);
const levelOptions = () => ({ levels: curriculum?.availableLevels || [], loadedLevels: curriculum?.loadedLevels || [] });
const currentLevel = (p = profile()) => learnerLevel(items, p, levelOptions());
const ctx = (p = profile()) => ({ maxLevel: currentLevel(p) });
const statusOf = (item, p = profile()) => statusFor(item, p, Date.now(), ctx(p));
const levelOf = id => getItem(id)?.level;
const nextLevelAfter = level => (curriculum?.availableLevels || []).find(l => l > level);
const readingsOf = item => item.readings || [];
const pad2 = n => String(n).padStart(2, '0');
const hoursText = ms => ms >= 864e5 ? `${ms/864e5} day${ms===864e5?'':'s'}` : `${ms/36e5} hours`;
/** Glyph markup: the real character, or a sanitized local SVG for image-only radicals. Never a guessed substitute. */
function glyph(item, alt = 'radical image') {
 if (item?.character) return `<span lang="ja">${esc(item.character)}</span>`;
 const url = isSafeImagePath(item?.characterImage) ? images.get(item.characterImage) : null;
 if (url) return `<img class="glyph-img" src="${esc(url)}" alt="${esc(alt)}">`;
 return `<span class="glyph-missing">${esc(alt === '' ? '' : 'image unavailable')}</span>`;
}
const glyphLabel = item => item?.character || 'image radical';
const timeUntil = timestamp => {
 if (!timestamp) return 'After your first lesson';
 const mins = Math.ceil((timestamp-Date.now())/60000);
 if (mins <= 0) return 'Ready now';
 if (mins < 60) return `in ${mins} min`;
 const hours = Math.floor(mins/60), rest = mins%60;
 if (hours < 24) return `in ${hours}h${rest ? ` ${rest}m` : ''}`;
 return `in ${Math.ceil(hours/24)} days`;
};
const prettyDate = timestamp => new Date(timestamp).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500); }
function readState() {
 try {
  savedRaw = localStorage.getItem(KEY);
  if (savedRaw) {
   const data=JSON.parse(savedRaw);
   if(data.version!==1 || !Array.isArray(data.profiles) || !data.profiles.length) throw Error('Invalid saved data');
   data.profiles = data.profiles.map(validateProfile);
   if(!data.profiles.some(p=>p.id===data.activeProfileId)) data.activeProfileId=data.profiles[0].id;
   return data;
  }
 } catch(error) { storageOK=false; }
 const p=newProfile('Learner 1');
 return {version:1,activeProfileId:p.id,profiles:[p]};
}
// Lossless: unknown/future subject IDs and extra fields are kept; nothing is filled in or dropped.
function validateProfile(value) { return checkProfile(value); }
function persist(next) {
 if(!storageOK) { toast('Saving is unavailable. Export a backup before you close this tab.'); state=next; return true; }
 try {
  const current=localStorage.getItem(KEY);
  if(current!==savedRaw) { state=readState(); session=null; render(); toast('Progress changed in another tab. Your latest saved progress has been loaded. Please retry.'); return false; }
  const raw=JSON.stringify(next); localStorage.setItem(KEY,raw); savedRaw=raw; state=next; return true;
 } catch { storageOK=false; state=next; toast('Your browser could not save. Export a backup before closing.'); return true; }
}
async function updateProfile(p) {
 if (!sync.state.profile && !cloud.getSession()) return persist({...state,profiles:state.profiles.map(x=>x.id===p.id?p:x)});
 const result = await sync.update(p);
 if (result === 'blocked') { toast('Resolve the cloud connection before making more changes.'); return false; }
 return result;
}
function render() {
 const p=profile(), s=stats(items,p,Date.now(),ctx(p));
 $('#app').innerHTML=`
 <a class="skip-link" href="#main">Skip to main content</a>
 <aside class="sidebar">
  <a class="brand" href="#dashboard" aria-label="Komorebi dashboard"><span class="brand-mark">木</span><span>komorebi<small>YOUR DAILY JAPANESE</small></span></a>
  <div class="workspace-label">YOUR STUDY SPACE</div>
  <nav aria-label="Main navigation">
   ${[['dashboard','home','Dashboard'],['library','book','Study library'],['guide','leaf','How it works'],['settings','settings','Settings']].map(([id,i,label])=>`<button class="nav-link ${view===id?'active':''}" data-nav="${id}" ${view===id?'aria-current="page"':''}>${icon(i)}<span>${label}</span>${id==='dashboard'&&s.reviews?`<span class="nav-count">${s.reviews}</span>`:''}</button>`).join('')}
  </nav>
  <div class="sidebar-bottom"><div class="small-sprout">${icon('leaf')}</div><h3>A little, every day.</h3><p>A few quiet minutes can take you a long way.</p><div class="sidebar-line"></div><span class="local-indicator"></span> ${sync.state.profile?(sync.state.error?'Cloud sync needs attention':'Synced to your account'):storageOK?'Guest progress on this device':'Saving unavailable'}</div>
 </aside>
 <div class="main-shell">
  <header class="topbar"><span class="breadcrumb">My learning <span>/</span> <strong>${session ? (session.mode==='lesson'?'Lessons':session.mode==='review'?'Reviews':session.mode==='placement'?'Placement':'Practice') : {dashboard:'Dashboard',library:'Study library',guide:'How it works',settings:'Settings'}[view]}</strong></span><div class="header-actions"><span class="level-pill" aria-label="Your level: ${currentLevel(p)}">LEVEL <b>${pad2(currentLevel(p))}</b></span><button class="profile-button" data-action="profiles" aria-label="Your learner account"><span class="avatar">${esc(Array.from(p.name)[0].toUpperCase())}</span><span class="profile-name">${esc(p.name)}</span><span class="down-chevron">⌄</span></button></div></header>
  <main id="main" tabindex="-1">${accountBanner()}${dataBanner()}${!storageOK?'<div class="storage-warning">Your browser could not load or save progress. You can study, but export a backup before closing. Existing saved data has not been overwritten.</div>':''}${session?renderSession():view==='dashboard'?dashboard(s):view==='library'?library():view==='guide'?guide():settings()}</main>
  <footer><span>木漏れ日 <span class="footer-dot">·</span> Sunlight through the leaves.</span><span>Inspired by WaniKani <span class="footer-dot">·</span> Made for a little daily growth</span></footer>
 </div>`;
 bind();
 if(session?.phase==='quiz' && !session.feedback) requestAnimationFrame(()=>$('#answer')?.focus());
}
function dashboard(s) {
 const p=profile(), level=currentLevel(p), lp=levelProgress(items,p,level), nextLevel=nextLevelAfter(level);
 const levelItems=items.filter(i=>i.level===level), learnedInLevel=levelItems.filter(i=>p.progress[i.id]?.stage>0).length;
 const nextFailed=nextLevel!=null && curriculum?.failedLevels.includes(nextLevel);
 const levelCaption=nextLevel==null?'You’ve reached the last level available in this app. Keep reviewing to grow every subject to Burned.':lp.kanjiPassed>=lp.required?`Level ${nextLevel} is unlocked.`:`${lp.required-lp.kanjiPassed} more kanji at Guru unlock Level ${nextLevel} (${lp.required} of ${lp.kanjiTotal} needed).${nextFailed?' Its study data could not be loaded yet.':''}`;
 const next=s.nextReviewAt;
 return `<section class="page-intro"><div><div class="eyebrow">THE EVERYDAY PRACTICE</div><h1>Your Japanese journey</h1><p>One character at a time. One step closer.</p></div><span class="date-label">${new Date().toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'})}</span></section>
 <section class="hero"><div class="hero-copy"><span class="hero-tag"><span></span> A GOOD DAY TO BEGIN</span><h2>Small steps.<br><em>Lasting knowledge.</em></h2><p>Build your foundation with radicals, bring kanji<br class="desktop-br"> to life, and make new words your own.</p><button class="button primary" data-action="lessons" ${s.lessons?'':'disabled'}>${s.learned?'Continue learning':'Let’s learn something'} ${icon('arrow')}</button><span class="hero-caption">${s.lessons ? `${Math.min(batchSizeOf(p),s.lessons)} small lessons. A little progress.`:'Your next lessons unlock as you review.'}</span></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><span class="art-word word-one">日</span><span class="art-word word-two">山</span><span class="art-word word-three">人</span><span class="tree-tile">木</span><svg class="botanical" viewBox="0 0 180 220"><path d="M88 215C111 161 78 92 114 19"/><path d="M96 172C34 168 37 124 88 130C103 151 96 172 96 172Z"/><path d="M98 130C162 128 158 84 114 91C97 110 98 130 98 130Z"/><path d="M97 85C58 77 65 40 102 54C109 71 97 85 97 85Z"/><path d="M113 41C155 36 146 9 122 15C113 26 113 41 113 41Z"/></svg><span class="vertical-japanese">毎日、少しずつ。</span><span class="art-note">a little growth, every day</span></div></section>
 <section class="action-grid" aria-label="Study actions"><button class="action-card lessons-card" data-action="lessons" ${s.lessons?'':'disabled'}><div class="action-icon">${icon('book')}</div><div class="action-text"><span>New lessons</span><strong>${s.lessons}<small>ready to discover</small></strong></div><span class="round-arrow">${icon('arrow')}</span></button><button class="action-card reviews-card" data-action="reviews" ${s.reviews?'':'disabled'}><div class="action-icon">${icon('clock')}</div><div class="action-text"><span>Your reviews</span><strong>${s.reviews}<small>${s.reviews?'ready to remember':next?`next ${timeUntil(next)}`:'start with a lesson'}</small></strong></div><span class="round-arrow">${icon('arrow')}</span></button></section>
 <section class="panel placement-panel"><div class="panel-heading"><div><span class="eyebrow">ALREADY KNOW JAPANESE?</span><h2>Placement check</h2></div></div><p>A short meaning (and reading) quiz. Score ≥90% or a strong streak marks those subjects Guru I so you skip the early waits—without burning them.</p><button class="button secondary" data-action="placement">Start placement ${icon('arrow')}</button></section>
 <div class="dashboard-grid"><div class="dashboard-primary"><section class="panel level-panel"><div class="panel-heading"><div><span class="eyebrow">BUILDING YOUR FOUNDATION</span><h2>Level ${level}</h2></div><span class="subtle-badge">${learnedInLevel} / ${levelItems.length} learned</span></div><div class="level-progress-label"><span>Kanji at Guru</span><strong>${lp.kanjiPassed} <span>/ ${lp.kanjiTotal}</span></strong></div><div class="progress-track" role="progressbar" aria-label="Kanji at Guru in Level ${level}" aria-valuemin="0" aria-valuemax="${lp.kanjiTotal}" aria-valuenow="${lp.kanjiPassed}"><span style="width:${lp.kanjiTotal?lp.kanjiPassed/lp.kanjiTotal*100:0}%"></span>${lp.kanjiTotal&&nextLevel!=null?`<i class="unlock-mark" style="left:${lp.required/lp.kanjiTotal*100}%"></i>`:''}</div><p class="progress-caption">${esc(levelCaption)}</p><div class="type-tabs" role="group" aria-label="Subject type">${Object.entries(TYPES).map(([t,label])=>`<button data-filter="${t}" class="${t===filter?'selected':''}"><span class="type-dot ${t}"></span>${label}<span>${levelItems.filter(i=>i.type===t).length}</span></button>`).join('')}</div><div class="subject-grid">${levelItems.filter(i=>i.type===filter).map(i=>tile(i)).join('')}</div><div class="panel-foot"><div class="legend"><span class="legend-dot"></span> Available <span class="legend-dot locked"></span> Locked</div><button class="text-button" data-nav="library">Explore all subjects ${icon('arrow')}</button></div></section>
 <section class="panel growth-panel"><div class="panel-heading"><h2>Your growing knowledge</h2>${icon('leaf')}</div><div class="srs-grid">${[{name:'Apprentice',start:1,end:4},{name:'Guru',start:5,end:6},{name:'Master',start:7,end:7},{name:'Enlightened',start:8,end:8},{name:'Burned',start:9,end:9}].map((g,n)=>`<div class="srs-stat srs-${n}"><span class="srs-dot"></span><strong>${Object.values(p.progress).filter(x=>x&&x.stage>=g.start&&x.stage<=g.end).length}</strong><span>${g.name}</span></div>`).join('')}</div></section></div>
 <aside class="dashboard-secondary"><section class="panel upcoming-panel"><div class="panel-heading"><h2>Coming up</h2>${icon('clock')}</div><span class="eyebrow">NEXT 24 HOURS</span>${upcoming(p)}<div class="quiet-note">${icon('leaf')}<span>${next?'A little space helps a memory take root.':'Finish your first lessons and your review schedule will grow here.'}</span></div></section><section class="path-card"><span class="eyebrow">THE LEARNING PATH</span><h2>Little pieces.<br>A bigger picture.</h2><div class="path-step"><span class="path-icon radical">亠</span><div><strong>Radicals</strong><p>The building blocks</p></div></div><div class="path-step"><span class="path-icon kanji">木</span><div><strong>Kanji</strong><p>Characters with meaning</p></div></div><div class="path-step"><span class="path-icon vocabulary">山川</span><div><strong>Vocabulary</strong><p>Words you can use</p></div></div><button class="text-button" data-nav="guide">How it all connects ${icon('arrow')}</button></section></aside></div>`;
}
function tile(item) {
 const st=statusOf(item);
 return `<button class="subject-tile ${item.type} ${st.state==='locked'?'is-locked':''} ${st.stage>=5?'is-guru':''}" data-item="${esc(item.id)}" title="${esc(item.meaning)} · ${esc(st.state==='locked'?'Locked':st.stageName)}" aria-label="${esc(glyphLabel(item))}, ${esc(item.meaning)}, ${esc(st.state==='locked'?'locked':st.stageName)}">${glyph(item,'')}${st.state==='locked'?icon('lock'):st.stage>=5?'<span class="tile-check">✓</span>':''}</button>`;
}
function upcoming(p) {
 const now=Date.now(), active=Object.values(p.progress).filter(x=>x&&x.stage<9).length||1, spans=[{label:'Now',min:-Infinity,max:0},{label:'In 4 hours',min:0,max:4},{label:'In 8 hours',min:4,max:8},{label:'Later today',min:8,max:24}];
 return `<div class="forecast">${spans.map((s,index)=>{const count=Object.values(p.progress).filter(x=>x&&x.stage<9 && (x.availableAt-now)/36e5>s.min && (x.availableAt-now)/36e5<=s.max).length;return `<div class="forecast-row"><span>${s.label}</span><div class="forecast-track"><span style="width:${count?Math.max(12,count/active*100):0}%"></span></div><strong>${count}</strong></div>`;}).join('')}</div>`;
}
function libraryItems() {
 const lvl=libraryLevel??currentLevel();
 return items.filter(i=>(lvl==='all'||i.level===lvl));
}
function library() {
 const p=profile(), learner=currentLevel(p), lvl=libraryLevel??learner;
 const filtered=libraryItems().filter(i=>(filter==='all'||i.type===filter) && matchesSearch(i,search));
 const pages=Math.max(1,Math.ceil(filtered.length/LIBRARY_PAGE_SIZE)); if(libraryPage>=pages)libraryPage=pages-1;
 const start=libraryPage*LIBRARY_PAGE_SIZE, shown=filtered.slice(start,start+LIBRARY_PAGE_SIZE);
 const failed=lvl!=='all'&&curriculum?.failedLevels.includes(lvl);
 const levelChoices=(curriculum?.availableLevels||[]).map(l=>`<option value="${l}" ${lvl===l?'selected':''}>Level ${l}${curriculum.failedLevels.includes(l)?' · not loaded':l>learner?' · locked':l===learner?' · your level':''}</option>`).join('');
 const total=curriculum?.counts.total??items.length, levelsCount=curriculum?.loadedLevels.length||1;
 return `<section class="page-intro"><div><div class="eyebrow">A PLACE TO EXPLORE</div><h1>Study library</h1><p>Browse all ${total.toLocaleString('en')} subjects across ${levelsCount} level${levelsCount===1?'':'s'}. Browsing never unlocks lessons.</p></div><button class="button secondary" data-action="practice">${icon('play')} Free practice</button></section><section class="panel library-panel"><div class="library-toolbar"><label class="level-select"><span>Level</span><select id="library-level" aria-label="Browse level"><option value="all" ${lvl==='all'?'selected':''}>All levels</option>${levelChoices}</select></label><div class="type-tabs">${[['all','All subjects'],...Object.entries(TYPES)].map(([t,l])=>`<button data-filter="${t}" class="${filter===t?'selected':''}">${l}</button>`).join('')}</div><label class="search-box"><span class="sr-only">Search subjects</span><input id="search" type="search" placeholder="Search characters, meanings or readings…" value="${esc(search)}"></label></div>${lvl!=='all'&&lvl>learner?`<p class="small-note library-note">Level ${lvl} is browse-only for now. Its lessons open when you reach Level ${lvl}.</p>`:''}<p class="library-count" aria-live="polite">${filtered.length?`Showing ${start+1}–${start+shown.length} of ${filtered.length.toLocaleString('en')}`:''}</p><div class="library-list">${shown.map(i=>{const st=statusOf(i,p);return `<button class="library-row" data-item="${esc(i.id)}" aria-label="${esc(glyphLabel(i))}, ${esc(i.meaning)}, Level ${esc(i.level)}, ${esc(st.state==='locked'?'Locked':st.state==='lesson'?'Ready to learn':st.stageName)}"><span class="library-character ${i.type}">${glyph(i,'')}</span><span class="library-meaning"><strong>${esc(i.meaning)}</strong><small>${i.type==='radical'?'Radical · building block':esc(readingsOf(i).join(' / '))}</small></span><span class="subject-label ${i.type}">${i.type}</span><span class="status-label">L${esc(i.level)} · ${st.state==='locked'?'Locked':st.state==='lesson'?'Ready to learn':esc(st.stageName)}</span>${icon('chevron')}</button>`}).join('')||`<div class="empty-state">${failed?`Level ${lvl} could not be loaded. Your saved progress for it is kept. Reload to try again.`:'No subjects found. Try a character, meaning, or reading.'}</div>`}</div>${pages>1?`<nav class="pager" aria-label="Library pages"><button class="button secondary" data-page="prev" ${libraryPage===0?'disabled':''}>${icon('back')} Previous</button><span>Page ${libraryPage+1} of ${pages}</span><button class="button secondary" data-page="next" ${libraryPage>=pages-1?'disabled':''}>Next ${icon('arrow')}</button></nav>`:''}</section><p class="page-note">Free practice explores the visible list without changing your review schedule.</p>`;
}
function guide() {
 return `<section class="page-intro"><div><div class="eyebrow">FAMILIAR RHYTHM, YOUR OWN PACE</div><h1>A little practice goes a long way.</h1><p>A learning loop inspired by the WaniKani process you know.</p></div></section><div class="guide-grid"><section class="panel guide-section"><span class="number-label">01</span><h2>Learn the little pieces</h2><p>Start with a small batch of radicals. Read the memory story, then prove you remember with a short quiz. Radicals only need a meaning; kanji and vocabulary need both a meaning and a reading.</p></section><section class="panel guide-section"><span class="number-label">02</span><h2>Give your memory some space</h2><p>After you finish a lesson quiz, the item enters Apprentice. Your first review appears in 2 hours on Levels 1–2 and in 4 hours from Level 3. Correct reviews gradually increase the time before you see it again. Misses lower the stage and bring it back sooner.</p></section><section class="panel guide-section"><span class="number-label">03</span><h2>Build on what you remember</h2><p>When a radical reaches Guru, it can unlock kanji that use it. Guru kanji unlock vocabulary. When 90% of a level’s kanji have reached Guru, the next level opens. Earned unlocks stay earned even if a stage later drops.</p></section><section class="panel guide-section"><span class="number-label">04</span><h2>Make it a family habit</h2><p>Each learner has separate progress. Sign in with your email and password to save progress to your account and continue on another device. Guest profiles stay in this browser. Export a backup from Settings whenever you want an extra copy.</p></section></div><section class="panel schedule-panel"><h2>The review rhythm</h2><p>Each label shows the wait at that stage. Levels 1–2 use WaniKani’s faster Apprentice timing; Level 3 onward uses the standard timing.</p>${[['Levels 1–2',['2 hours','4 hours','8 hours','1 day']],['Level 3 and up',['4 hours','8 hours','1 day','2 days']]].map(([label,early])=>`<h3 class="schedule-label">${label}</h3><div class="schedule-flow">${[...early.map((d,n)=>`Apprentice ${n+1}|${d}`),'Guru 1|1 week','Guru 2|2 weeks','Master|30 days','Enlightened|120 days','Burned|Remembered'].map(t=>{const [n,d]=t.split('|');return `<div><strong>${n}</strong><span>${d}</span></div>`}).join('')}</div>`).join('')}<p class="page-note">This is an independent study app, not an official WaniKani client. Review times are kept exactly as scheduled when the app is updated.</p><a class="text-button" href="https://knowledge.wanikani.com/wanikani/srs-stages/" target="_blank" rel="noopener noreferrer">WaniKani’s SRS stages ${icon('arrow')}</a></section>`;
}
function settings() {
 const p=profile(), unknown=curriculum?unknownProgressIds(p,curriculum.knownIds).length:0, c=curriculum?.counts||{radical:0,kanji:0,vocabulary:0}, lv=curriculum?.loadedLevels||[];
 return `<section class="page-intro"><div><div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your study space</h1><p>A pace that fits you, and progress that stays yours.</p></div></section><div class="settings-grid"><section class="panel settings-section"><h2>Learner profile</h2><p>${sync.state.profile?'Your account keeps your lessons and reviews in sync.':'Guest profiles have separate progress on this browser.'}</p><label class="field-label" for="profile-name">Your name</label><form id="rename-form" class="inline-form"><input id="profile-name" required maxlength="40" value="${esc(p.name)}"><button class="button secondary">Save name</button></form><button class="text-button" data-action="profiles">${icon('people')} ${sync.state.profile?'Manage account':'Manage guest learners'}</button><hr><h2>Lesson size</h2><p>Choose how many new subjects to learn in one sitting.</p><div class="batch-options">${[3,5,10].map(n=>`<button class="${batchSizeOf(p)===n?'selected':''}" data-batch="${n}" aria-pressed="${batchSizeOf(p)===n}">${n}<small>subjects</small></button>`).join('')}</div></section><section class="panel settings-section"><h2>Keep your progress safe</h2><p>${sync.state.profile?'Your progress is saved to your cloud account after each completed lesson batch or review item. A backup gives you an extra copy.':'You’re using a guest profile. Progress lives in this browser until you sign in and transfer it to an empty account.'}</p>${sync.state.profile?`<div class="cloud-account">${icon('check')}<span><strong>${esc(cloud.getSession()?.user.email||'Your account')}</strong><small>${sync.state.error?'Sync needs attention':'Cloud progress connected'}</small></span></div><button class="text-button" data-action="change-password">${icon('lock')} Change password</button>`:`<button class="button secondary full-width" data-action="account">${icon('people')} Sign in to sync progress</button>`}<button class="button primary full-width" data-action="export">${icon('download')} Export my progress</button><label class="button secondary full-width import-label">Import a backup<input id="import-file" type="file" accept=".json,application/json" class="sr-only"></label>${unknown?`<p class="small-note">${unknown} saved subject${unknown===1?'':'s'} belong to levels that aren’t loaded in this version. They are kept safely in your progress and backups.</p>`:''}<p class="small-note">${sync.state.profile?'Import is available for an empty cloud account. Existing cloud progress is never replaced by an import.':'Importing adds a new guest profile. Sign in to an empty account to transfer your guest progress to the cloud.'}</p><hr><h2>Already know Japanese?</h2><p>Run a placement check on your current level (and earlier ones). Strong scores mark items Guru I—dependents unlock, early 2-hour waits are skipped, and later reviews stay light.</p><button class="button secondary full-width" data-action="placement">Start placement check</button><hr><h2>About this little space</h2><p>Komorebi (木漏れ日) means sunlight filtering through leaves. This version includes ${c.radical.toLocaleString('en')} radicals, ${c.kanji.toLocaleString('en')} kanji, and ${c.vocabulary.toLocaleString('en')} vocabulary words${lv.length?` across Level${lv.length===1?` ${lv[0]}`:`s ${lv[0]}–${lv[lv.length-1]}`}`:''}.</p><p class="small-note">Study explanations are from your supplied WaniKani export. WaniKani is a trademark of Tofugu LLC. This app is independent and unaffiliated.</p></section></div>`;
}
function subjectDetails(item, context='detail') {
 const st=statusOf(item);
 return `<div class="subject-banner ${item.type}"><span class="subject-kind">${item.type} <span>•</span> LEVEL ${esc(item.level)}</span><div class="big-character">${glyph(item,`${item.meaning} radical`)}</div><h2>${esc(item.meaning)}</h2>${readingsOf(item).length?`<p class="banner-reading" lang="ja">${esc(readingsOf(item).join(' ・ '))}</p>`:''}</div><div class="subject-content"><section><span class="eyebrow">MEANING</span><h3>${esc((item.meanings||[item.meaning]).join(' · '))}</h3><p>${esc(item.meaningMnemonic)||'Look closely at the character and connect its shape with its meaning.'}</p></section>${item.type!=='radical'?`<section><span class="eyebrow">READING</span><h3 lang="ja">${esc(readingsOf(item).join(' ・ '))}</h3><p>${esc(item.readingMnemonic)}</p>${item.otherReadings?.length?`<p class="small-note">Other kanji readings: <span lang="ja">${esc(item.otherReadings.join(' ・ '))}</span>. The quiz asks for the reading taught above.</p>`:''}</section>`:''}${item.components?.length?`<section><span class="eyebrow">BUILDING BLOCKS</span><div class="component-list">${item.components.map(c=>`<span><b>${glyph(c,'')}</b>${esc(c.name)}</span>`).join('')}</div></section>`:''}${item.sentences?.length?`<section><span class="eyebrow">IN CONTEXT</span>${item.sentences.slice(-3).map(s=>`<div class="sentence"><p lang="ja">${esc(s.japanese)}</p><small>${esc(s.english)}</small></div>`).join('')}</section>`:''}${context==='detail'?`<section class="subject-status"><strong>${st.state==='locked'?'Not unlocked yet':st.state==='lesson'?'Ready for your lessons':esc(st.stageName)}</strong><p>${st.state==='locked'?(st.unmetDependencies.length?`First reach Guru with: ${st.unmetDependencies.map(id=>esc(getItem(id)?`${getItem(id).meaning} (Level ${getItem(id).level})`:id)).join(', ')}.`:`Opens when you reach Level ${esc(item.level)}.`):st.availableAt?`Next review: ${prettyDate(st.availableAt)}`:'Every small step counts.'}</p></section>`:''}${!hasPassed(profile().progress[item.id])?`<div class="know-actions"><button class="button secondary full-width" type="button" data-action="mark-known" data-item="${esc(item.id)}">Already know this · mark Guru</button><p class="small-note">Skips early Apprentice waits. Sets Guru I so dependents unlock; light reviews stay on the schedule.</p></div>`:''}<a class="source-link" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">View the original on WaniKani ↗</a></div>`;
}
function openSubject(id) {
 const item=getItem(id); if(!item)return;
 const modal=$('#modal');modal.className='subject-dialog';modal.innerHTML=`<button class="modal-close" data-close aria-label="Close subject">${icon('close')}</button><span id="modal-title" class="sr-only">${esc(item.meaning)} details</span>${subjectDetails(item)}`;modal.showModal(); $('[data-close]',modal).onclick=()=>modal.close();
 modal.querySelectorAll('[data-action="mark-known"]').forEach(b=>b.onclick=async()=>{const id=b.dataset.item;if(id)await markKnown(id);});
}
function openProfiles() {
 if (cloud.getSession()) { openAccount(); return; }
 const modal=$('#modal');modal.className='profiles-dialog';modal.innerHTML=`<button class="modal-close" data-close aria-label="Close profiles">${icon('close')}</button><span class="eyebrow">YOUR FAMILY’S STUDY SPACE</span><h2 id="modal-title">Who’s learning today?</h2><p>Separate progress for every learner on this browser.</p><div class="profile-list">${state.profiles.map(p=>`<button data-profile="${esc(p.id)}"><span class="avatar">${esc(Array.from(p.name)[0].toUpperCase())}</span><span><strong>${esc(p.name)}</strong><small>${Object.keys(p.progress).length} subjects learned</small></span>${p.id===profile().id?icon('check'):icon('chevron')}</button>`).join('')}</div><form id="add-profile"><label class="field-label" for="new-name">Add a learner</label><div class="inline-form"><input id="new-name" placeholder="Your brother’s name" required maxlength="40"><button class="button primary">${icon('plus')} Add</button></div></form><p class="small-note">These are guest profiles on this browser. For accounts that sync across devices, sign in.</p><button class="button secondary full-width" id="guest-signin">Sign in to your account</button>`;modal.showModal();$('[data-close]',modal).onclick=()=>modal.close();
 $('#guest-signin').onclick=()=>{modal.close();openAccount();};
 modal.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{if(!leaveSession())return;if(persist({...state,activeProfileId:b.dataset.profile})){session=null;modal.close();render();}});
 $('#add-profile',modal).onsubmit=e=>{e.preventDefault();if(!leaveSession())return;const name=$('#new-name').value.trim();if(!name)return;const p=newProfile(name);if(persist({...state,activeProfileId:p.id,profiles:[...state.profiles,p]})){session=null;modal.close();render();toast(`Welcome, ${name}. Your journey starts here.`);}};
}
const LEAVE_MESSAGE='Leave this session? Completed review items are saved. An unfinished lesson batch or review item will need to be repeated.';

async function markKnown(itemId) {
  const item = getItem(itemId);
  if (!item) return;
  if (hasPassed(profile().progress[item.id])) { toast('Already at Guru or higher.'); return; }
  const ok = window.confirm(`Mark “${item.meaning}” as Guru I? You’ll skip early Apprentice waits. Dependents can unlock. Later reviews stay on the light schedule (not burned).`);
  if (!ok) return;
  const active = session;
  const next = withLevelRecord(markAsGuru(profile(), item.id, { level: item.level }, Date.now()));
  // A failed save leaves the profile and the active lesson exactly as they were.
  if (!await updateProfile(next)) return;
  // Lessons browse in phase 'learn'; the quiz is built later from session.selected, so removing
  // the subject here also keeps it out of that quiz. Skip if the session changed during the save.
  if (active && session === active && active.mode === 'lesson' && active.phase === 'learn') {
    const removed = active.selected.findIndex((x) => x.id === item.id);
    if (removed >= 0) {
      const selected = active.selected.filter((x) => x.id !== item.id);
      if (!selected.length) {
        session = null;
        if ($('#modal').open) $('#modal').close();
        go('dashboard');
        toast(`“${item.meaning}” is Guru I. No lessons left in this batch.`);
        return;
      }
      const position = Math.min(removed < active.position ? active.position - 1 : active.position, selected.length - 1);
      session = { ...active, selected, position };
    }
  }
  if ($('#modal').open && $('#modal').classList.contains('subject-dialog')) $('#modal').close();
  render();
  toast(`“${item.meaning}” is Guru I. Dependents can unlock.`);
}

function beginPlacement() {
  if (busy || (sync.state.profile && sync.state.error)) { toast('Resolve cloud sync first so your progress can be saved safely.'); return; }
  if (session && session.phase !== 'done' && !window.confirm(LEAVE_MESSAGE)) return;
  // The level tested is fixed here; graduation offers and labels use it even if passing
  // the quiz unlocks the next level.
  const level = currentLevel(profile());
  const sample = selectPlacementSample(items, profile(), { maxLevel: level, size: PLACEMENT_SAMPLE_SIZE });
  if (!sample.length) { toast('Everything up to your level is already Guru or higher.'); return; }
  const queue = buildQuizQueue(sample);
  session = {
    mode: 'placement',
    phase: 'quiz',
    placementLevel: level,
    placementExpected: queue.map((q) => ({ ...q })),
    selected: sample,
    queue,
    position: 0,
    finished: [],
    mistakes: {},
    answers: 0,
    correct: 0,
    placementAnswers: [],
    feedback: null,
  };
  render();
  window.scrollTo(0, 0);
}

async function finishPlacement(from = session) {
  const s = from;
  // Only a running placement quiz can finish, so a second call while saving or done does nothing.
  if (!s || s.mode !== 'placement' || s.phase !== 'quiz') return;
  // Level captured at placement start (fallback: the level before this save, never after).
  const level = Number.isInteger(s.placementLevel) ? s.placementLevel : currentLevel(profile());
  const scored = scorePlacement(s.placementAnswers || [], { expected: s.placementExpected });
  const result = { placementScore: scored, graduateLevel: level, feedback: null };
  if (!scored.passed) {
    session = { ...s, ...result, phase: 'done', placementGranted: [] };
    render();
    return;
  }
  const owner = profile().id;
  let next = markAsGuruMany(profile(), scored.grantIds, levelOf, Date.now());
  next = withLevelRecord(next);
  // B1: an explicit saving state is installed before the save, so every render during it
  // (including the cloud sync's settle → onChange → render) is valid. No result is shown
  // until the save has resolved.
  const saving = { ...s, ...result, phase: 'saving', queue: [] };
  session = saving;
  render();
  const saved = await updateProfile(next);
  // Replaced during the save (save error, account change, another tab, or the learner left):
  // that owner of the screen decides what is shown.
  if (session !== saving) return;
  if (profile().id !== owner) { session = null; render(); return; }
  if (!saved) {
    // Not saved (e.g. sync blocked). Cloud save errors that keep a pending draft go through
    // onSaveError, which already closed the session above.
    session = { ...saving, phase: 'done', placementGranted: [], placementSaveFailed: true };
    render();
    return;
  }
  const cands = graduateLevelCandidates(items, next, level, ctx(next));
  session = {
    ...saving,
    phase: 'done',
    placementGranted: scored.grantIds,
    graduateCandidates: cands,
  };
  render();
}

async function graduatePlacementLevel() {
  const s = session;
  if (!s?.graduateCandidates?.length) return;
  const ids = s.graduateCandidates.map((i) => i.id);
  const level = s.graduateLevel;
  if (!window.confirm(`Also mark ${ids.length} more unlocked subject${ids.length===1?'':'s'} on Level ${level} as Guru I?`)) return;
  let next = markAsGuruMany(profile(), ids, levelOf, Date.now());
  next = withLevelRecord(next);
  if (!await updateProfile(next)) return;
  session = { ...s, graduateCandidates: [], placementExtra: ids.length };
  render();
  toast(`Marked ${ids.length} more Level ${level} subject${ids.length===1?'':'s'} Guru I.`);
}

function leaveSession(){return !session || session.phase==='done' || window.confirm(LEAVE_MESSAGE);}
// Browser history: each view has an entry (#library, #guide, #settings; the dashboard has no hash).
// A lesson/review/practice session gets its own entry, so Back asks before leaving it.
const urlForView=v=>`${location.pathname}${location.search}${v==='dashboard'?'':'#'+v}`;
function historyCall(method,data,url){try{history[method](data,'',url);}catch{}}
function setView(next){if(view==='library'&&next!=='library'){search='';libraryPage=0;}view=next;if(view==='dashboard'&&filter==='all')filter='radical';}
function go(next){
 if(!leaveSession())return false;
 const fromSession=Boolean(history.state?.session);session=null;
 if(fromSession)historyCall('replaceState',{view:next},urlForView(next));
 else if(next!==view)historyCall('pushState',{view:next},urlForView(next));
 setView(next);render();window.scrollTo(0,0);return true;
}
window.addEventListener('popstate',e=>{
 if(!state)return;
 const target=e.state?.view||viewFromHash(location.hash)||'dashboard';
 // Stay put while a save is running, or when the learner cancels leaving an active session.
 if(busy||(session&&session.phase!=='done'&&!window.confirm(LEAVE_MESSAGE))){historyCall('pushState',session?{view,session:true}:{view},urlForView(view));return;}
 session=null;if($('#modal').open)$('#modal').close();setView(target);render();window.scrollTo(0,0);
});
function begin(mode) {
 if (busy || (sync.state.profile && sync.state.error)) {toast('Resolve cloud sync first so your progress can be saved safely.');return;}
 const p=profile();let selected=mode==='lesson'?availableLessons(items,p,ctx(p)).slice(0,batchSizeOf(p)):mode==='review'?dueReviews(items,p,Date.now()):practicePool(libraryItems(),filter,search,10);
 if(!selected.length){toast(mode==='review'?'You’re all caught up. Come back when reviews are due.':'No subjects are available for this session.');return;}
 session={mode,phase:mode==='lesson'?'learn':'quiz',selected,position:0,queue:[],mistakes:{},finished:[],feedback:null,answers:0,correct:0,startedAt:Date.now()};
 if(history.state?.session)historyCall('replaceState',{view,session:true},urlForView(view));else historyCall('pushState',{view,session:true},urlForView(view));
 if(mode!=='lesson')makeQuiz();render();window.scrollTo(0,0);
}
function makeQuiz(){session.phase='quiz';session.queue=buildQuizQueue(session.selected);session.totalQuestions=session.queue.length;}
function renderSession() {
 const s=session;
 if(s.phase==='done')return `<section class="session-done"><div class="done-icon">${icon('check')}</div><span class="eyebrow">A LITTLE MORE THAN YESTERDAY</span><h1>${s.mode==='lesson'?'A new beginning.':s.mode==='practice'?'Practice makes progress.':s.mode==='placement'?(s.placementScore?.passed?'Placement cleared.':'Keep studying—almost there.'):'Nicely remembered.'}</h1><p>${s.mode==='lesson'?`${s.selected.length} subjects planted in your memory. Your first reviews arrive in ${hoursText(Math.min(...s.selected.map(i=>intervalFor(1,i.level))))}.`:s.mode==='practice'?'A little extra practice, with your review schedule unchanged.':s.mode==='placement'?`${s.placementScore?Math.round(s.placementScore.ratio*100):0}% correct${s.placementSaveFailed?'. Your results could not be saved, so nothing was changed.':s.placementScore?.passed?` · ${s.placementGranted?.length||0} subject${(s.placementGranted?.length||0)===1?'':'s'} marked Guru I.`:'. Score ≥90% or an 8-answer streak to place.'}${s.placementScore?.passed&&!s.placementSaveFailed&&s.graduateCandidates?.length?` <button class="button secondary" data-action="graduate-level" type="button">Also mark ${s.graduateCandidates.length} unlocked on Level ${esc(s.graduateLevel)}</button>`:''}${s.placementExtra?` (+${s.placementExtra} more)`:''}`:`${s.finished.length} subjects reviewed. Your next review times are saved.`}</p><div class="result-cards"><div><strong>${s.mode==='lesson'?s.selected.length:s.finished.length}</strong><span>subjects ${s.mode==='lesson'?'learned':'completed'}</span></div><div><strong>${s.answers?Math.round(s.correct/s.answers*100):100}%</strong><span>answer accuracy</span></div></div><button class="button primary" data-action="finish">Back to your dashboard ${icon('arrow')}</button></section>`;
 if(s.phase==='saving')return `<section class="session-done session-saving" aria-busy="true"><div class="done-icon">${icon('clock')}</div><span class="eyebrow">PLACEMENT CHECK</span><h1>Saving your placement results…</h1><p role="status">Please keep this page open. Your results appear as soon as they are saved.</p></section>`;
 const learning=s.phase==='learn', item=learning?s.selected[s.position]:getItem(s.queue[0].id), kind=learning?'':s.queue[0].kind;
 const complete=learning?s.position:s.totalQuestions-s.queue.length;
 return `<section class="session-header"><button class="text-button" data-action="exit-session">${icon('back')} Dashboard</button><span>${s.mode==='lesson'?'New lessons':s.mode==='review'?'Spaced reviews':s.mode==='placement'?'Placement check':'Free practice'} <b>·</b> ${learning?`${s.position+1} of ${s.selected.length}`:`${s.finished.length} of ${s.selected.length} subjects`}</span></section><div class="session-progress"><span style="width:${learning?s.position/s.selected.length*100:s.finished.length/s.selected.length*100}%"></span></div>${learning?`<section class="lesson-card">${subjectDetails(item,'lesson')}<div class="lesson-controls"><button class="button secondary" data-action="previous-lesson" ${s.position===0?'disabled':''}>${icon('back')} Previous</button><span>${s.position+1} / ${s.selected.length}</span><button class="button primary" data-action="next-lesson">${s.position===s.selected.length-1?'Start the quiz':'Next subject'} ${icon('arrow')}</button></div>${!hasPassed(profile().progress[item.id])?`<button class="text-button know-inline" data-action="mark-known" data-item="${esc(item.id)}">Already know this · mark Guru</button>`:''}</section>`:`<section class="quiz-card"><div class="quiz-prompt ${item.type}"><span class="subject-kind">${item.type} <span>•</span> ${kind==='meaning'?'MEANING':'READING'}</span><div class="quiz-character">${glyph(item,'radical image')}</div></div><div class="quiz-body"><h1>${kind==='meaning'?'What does this mean?':'How do you read this?'}</h1><p>${kind==='meaning'?'Enter an English meaning.':item.type==='kanji'?'Enter the reading you learned for this kanji.':'Enter this word’s reading in kana or romaji.'}</p><form id="answer-form"><label class="sr-only" for="answer">${kind==='meaning'?'Meaning in English':'Reading in kana or romaji'}</label><input id="answer" class="answer-input ${s.feedback?s.feedback.correct?'correct':s.feedback.retry?'retry':'incorrect':''}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${kind==='meaning'?'Your answer…':'かな or romaji…'}" ${s.feedback?'disabled':''} value="${esc(s.feedback?.answer||'')}"><div id="kana-preview" class="kana-preview" lang="ja">${kind==='reading'?'Romaji is converted to hiragana when you answer.':'Press Enter to check your answer.'}</div>${s.feedback?`<div class="answer-feedback ${s.feedback.correct?'correct':s.feedback.retry?'retry':'incorrect'}" role="status"><strong>${s.feedback.correct?'That’s right!':s.feedback.retry?'Another reading—try the one taught here.':'Not quite. Let’s try it again.'}</strong><span>${esc(feedbackSummary(item,kind,s.feedback,s.queue))}</span></div><button type="button" class="button primary full-width" data-action="continue-answer">Continue ${icon('arrow')}</button>${!s.feedback.correct&&!s.feedback.retry?`<details class="answer-explanation"><summary>Revisit the memory story</summary><p>${esc(kind==='meaning'?item.meaningMnemonic:item.readingMnemonic)}</p></details>`:''}`:`<button class="button primary full-width" type="submit">Check answer ${icon('arrow')}</button><button class="text-button dont-know" type="button" data-action="dont-know">I don’t remember yet</button>`}</form></div></section><p class="session-footnote">${s.mode==='practice'?'Just practice. Your spaced review progress will stay the same.':s.mode==='placement'?'Placement only marks Guru when you pass (≥90% or an 8-answer streak). Nothing is demoted.':s.mode==='lesson'?'You’ll recall every answer correctly before these lessons are saved.':'Both meaning and reading must be recalled before an item is complete.'}</p>`}`;
}
function submitAnswer(unknown=false) {
 if(!session||session.phase!=='quiz'||session.feedback)return;
 const q=session.queue[0],item=getItem(q.id),answer=$('#answer').value.trim();
 if(!unknown&&!answer){toast('Enter an answer, or choose “I don’t remember yet”.');return;}
 const result=unknown?{correct:false}:checkAnswer(item,q.kind,answer);
 if(!result.retry){
  session.answers++;
  if(result.correct)session.correct++;
  else session.mistakes[item.id]=(session.mistakes[item.id]||0)+1;
  if(session.mode==='placement'){
   session.placementAnswers=(session.placementAnswers||[]).concat([{id:item.id,kind:q.kind,correct:!!result.correct}]);
  }
 }
 session.feedback={...result,answer:unknown?'':answer};render();requestAnimationFrame(()=>$('[data-action="continue-answer"]')?.focus());
}
async function continueAnswer(){
 if(!session?.feedback||busy)return;
 const s=structuredClone(session);
 if(!s.feedback.retry){
  const q=s.queue.shift();if(!s.feedback.correct && s.mode!=='placement')s.queue.push(q);
  if(!s.queue.some(x=>x.id===q.id) && !s.finished.includes(q.id)) {
   if(s.mode==='review' && !await updateProfile(withLevelRecord(completeReview(profile(),q.id,{mistakes:s.mistakes[q.id]||0,level:levelOf(q.id)},Date.now()))))return;
   s.finished.push(q.id);
  }
 }
 s.feedback=null;
 if(s.mode==='placement'){
  if(placementShouldFinish(s.placementAnswers||[],s.queue)){await finishPlacement(s);return;}
 }
 if(!s.queue.length){if(s.mode==='lesson'&&!await updateProfile(withLevelRecord(startLearning(profile(),s.selected.map(i=>i.id),Date.now(),levelOf))))return;s.phase='done';}
 session=s;render();
}
/** After a learning event, record a newly earned level permanently (never on load). */
function withLevelRecord(next){
 const before=currentLevel(profile()), after=learnerLevel(items,next,levelOptions());
 if(after>before)setTimeout(()=>toast(`Level ${after} is unlocked. New lessons are ready to grow.`),0);
 return recordLevelUnlock(next,after);
}
function exportProgress(){const blob=new Blob([serializeBackup(profile())],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`komorebi-${profile().name.replace(/[^a-z0-9_-]/gi,'-')}-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your progress backup is ready.');}
async function importProgress(file){if(!file)return;try{/* Same size/app/version policy as readBackupFile (BACKUP_MAX_BYTES = 8_000_000). */if(file.size>8000000)throw Error('Please choose a Komorebi backup smaller than 8 MB.');const data=JSON.parse(await file.text());if(data.app!=='komorebi'||data.version!==1)throw Error('Please choose a Komorebi progress backup.');const p=validateProfile(data.profile);if(cloud.getSession()){if(Object.keys(profile().progress).length)throw Error('Import is only available for an empty cloud account. Export the existing progress first.');p.id=cloud.getSession().user.id;if(await updateProfile(p)){render();toast('Backup saved to your cloud account.');}return;}p.id=crypto.randomUUID();p.name=p.name.slice(0,38)+' (imported)';if(persist({...state,activeProfileId:p.id,profiles:[...state.profiles,p]})){render();toast('Backup imported as a new learner profile.');}}catch(error){toast(error.message||'That backup could not be imported. Your progress is unchanged.');}}
function bind(){
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>go(b.dataset.nav));
 $('.brand').onclick=e=>{e.preventDefault();go('dashboard');};
 $('.skip-link').onclick=e=>{e.preventDefault();const main=$('#main');main.focus();main.scrollIntoView({block:'start'});};
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;libraryPage=0;render();});
 document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{libraryPage+=b.dataset.page==='next'?1:-1;if(libraryPage<0)libraryPage=0;render();$('.library-count')?.scrollIntoView({block:'nearest'});$(`[data-page="${b.dataset.page}"]`)?.focus();});
 if($('#library-level'))$('#library-level').onchange=e=>{libraryLevel=e.target.value==='all'?'all':Number(e.target.value);libraryPage=0;render();$('#library-level').focus();};
 document.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>openSubject(b.dataset.item));
 document.querySelectorAll('[data-batch]').forEach(b=>b.onclick=async()=>{if(await updateProfile({...profile(),settings:{...profile().settings,batchSize:Number(b.dataset.batch)}}))render();});
 document.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{
  const action=b.dataset.action;
  if(busy)return;
  if(action==='account')openAccount();
  if(action==='change-password')openAccount('new-password');
  if(action==='retry-cloud')retryCloud();
  if(action==='reload-cloud')reloadCloud();
  if(action==='upload-guest')uploadGuest();
  if(action==='profiles')openProfiles();
  if(action==='lessons')begin('lesson');
  if(action==='reviews')begin('review');
  if(action==='practice')begin('practice');
  if(action==='placement')beginPlacement();
  if(action==='mark-known'){const id=b.dataset.item;if(id)await markKnown(id);}
  if(action==='graduate-level')await graduatePlacementLevel();
  if(action==='export')exportProgress();
  if(action==='reload-page'&&leaveSession())location.reload();
  if(action==='next-lesson'){if(session.position<session.selected.length-1)session.position++;else makeQuiz();render();window.scrollTo(0,0);}
  if(action==='previous-lesson'&&session.position>0){session.position--;render();window.scrollTo(0,0);}
  if(action==='continue-answer')continueAnswer();
  if(action==='dont-know')submitAnswer(true);
  if(action==='finish'||action==='exit-session'){if(action==='exit-session'&&!leaveSession())return;session=null;go('dashboard');}
 });
 if($('#answer-form'))$('#answer-form').onsubmit=e=>{e.preventDefault();submitAnswer();};
 if($('#answer')&&session.queue[0]?.kind==='reading')$('#answer').oninput=e=>{$('#kana-preview').textContent=e.target.value?toHiragana(e.target.value):'Romaji is converted to hiragana when you answer.';};
 if($('#search'))$('#search').oninput=e=>{const pos=e.target.selectionStart;search=e.target.value;libraryPage=0;render();$('#search').focus();try{$('#search').setSelectionRange(pos,pos);}catch{}};
 if($('#rename-form'))$('#rename-form').onsubmit=async e=>{e.preventDefault();const name=$('#profile-name').value.trim();if(name&&await updateProfile({...profile(),name})){render();toast('Your name has been updated.');}};
 if($('#import-file'))$('#import-file').onchange=e=>importProgress(e.target.files[0]);
}
function accountBanner(){
 if(sync.state.profile&&sync.state.error)return `<div class="cloud-banner error" role="alert"><span>${esc(sync.state.error)} ${sync.state.pending?'Your unsynced progress is kept on this device.':''}</span><div class="auth-links"><button class="text-button" data-action="retry-cloud">${sync.state.errorCode==='AUTH_REQUIRED'?'Sign in again':'Retry'}</button>${sync.state.pending?'<button class="text-button" data-action="export">Export backup</button><button class="text-button" data-action="reload-cloud">Load cloud copy</button>':''}</div></div>`;
 if(sync.state.profile){return !Object.keys(sync.state.profile.progress).length&&Object.keys(guestProfile().progress).length?`<div class="cloud-banner"><span>You have ${Object.keys(guestProfile().progress).length} subjects in your guest profile. Bring them into this empty account.</span><button class="text-button" data-action="upload-guest">Transfer guest progress ${icon('arrow')}</button></div>`:'';}
 return `<div class="cloud-banner"><span>${cloud.isConfigured?'Guest mode · Sign in to keep your progress in sync across devices.':'Guest preview · Cloud accounts haven’t been connected yet.'}</span><button class="text-button" data-action="account">${cloud.isConfigured?'Sign in':'About accounts'} ${icon('arrow')}</button></div>`;
}
function dataBanner(){
 if(!curriculum?.failedLevels.length)return '';
 const f=curriculum.failedLevels;
 return `<div class="storage-warning" role="status">Study data for Level${f.length===1?'':'s'} ${esc(f.join(', '))} could not be loaded. Your saved progress for ${f.length===1?'it':'them'} is kept and nothing has been removed. <button class="text-button" data-action="reload-page">Reload</button></div>`;
}
function setBusy(value,message='Saving your progress…'){
 busy=value;document.querySelector('.busy-cover')?.remove();
 if(value){const el=document.createElement('div');el.className='busy-cover';el.setAttribute('role','status');el.innerHTML=`<span>${esc(message)}</span>`;document.body.appendChild(el);}
}
async function retryCloud(){if(sync.state.errorCode==='AUTH_REQUIRED'||!cloud.getSession()){openAccount();return;}await sync.retry();render();}
async function reloadCloud(){if(sync.state.pending&&!window.confirm('Load the latest cloud copy and discard this device’s unsynced changes? Export a backup first if you want to keep both.'))return;session=null;await sync.reload();}
const connectCloud=()=>sync.connect();
async function uploadGuest(){if(busy||!sync.state.profile||Object.keys(sync.state.profile.progress).length)return;const p={...structuredClone(guestProfile()),id:cloud.getSession().user.id};if(await updateProfile(p)){render();toast('Your guest progress is now saved to your account.');}}
function openAccount(mode='signin'){
 const modal=$('#modal');if(modal.open)modal.close();modal.className='auth-dialog';
 const auth=cloud.getSession();
 if(!cloud.isConfigured){
  modal.innerHTML=`<button class="modal-close" data-close aria-label="Close accounts">${icon('close')}</button><span class="eyebrow">YOUR PROGRESS, WHEREVER YOU ARE</span><h2 id="modal-title">One account. Your own journey.</h2><p>Email/password accounts will keep each learner’s progress separate and let you continue on another device.</p><div class="auth-note">Cloud accounts are waiting for the app owner to connect the backend. You can try the full learning flow with a guest profile today.</div><button class="button primary full-width" id="continue-guest">Continue as a guest ${icon('arrow')}</button>`;
  modal.showModal();$('[data-close]',modal).onclick=()=>modal.close();$('#continue-guest').onclick=()=>modal.close();return;
 }
 if((mode==='new-password'||mode==='recovery')&&!auth){toast('Sign in to change your password.');mode='signin';}
 if(auth&&mode!=='new-password'&&mode!=='recovery'){
  modal.innerHTML=`<button class="modal-close" data-close aria-label="Close account">${icon('close')}</button><span class="eyebrow">YOUR OWN STUDY SPACE</span><h2 id="modal-title">${esc(profile().name)}</h2><p>${esc(auth.user.email)}</p><div class="auth-note">${sync.state.error?esc(sync.state.error):'Your completed lessons and reviews are saved to this account. Sign in with the same email on another device to continue.'}</div><button class="button secondary full-width" id="refresh-cloud">Refresh from cloud</button><button class="button secondary full-width" id="cloud-export">Export progress backup</button><button class="button secondary full-width" id="change-password">${icon('lock')} Change password</button><button class="button primary full-width" id="signout">Sign out on this device</button><p id="auth-error" class="auth-error" role="alert"></p>`;
  modal.showModal();$('[data-close]',modal).onclick=()=>modal.close();$('#cloud-export').onclick=exportProgress;$('#change-password').onclick=()=>openAccount('new-password');$('#refresh-cloud').onclick=async()=>{if(!leaveSession())return;modal.close();await reloadCloud();};
  $('#signout').onclick=async()=>{if(!leaveSession())return;if(sync.state.pending){$('#auth-error').textContent='Sync or export your pending progress before signing out.';return;}$('#signout').disabled=true;try{await cloud.signOut();sync.reset(null);session=null;modal.close();render();toast('Signed out. Your cloud progress is safe.');}catch(error){$('#auth-error').textContent=error.message;$('#signout').disabled=false;}};return;
 }
 // 'new-password' = signed-in change (current password required, no email). 'recovery' = arriving from a
 // Supabase recovery link (no current password known). 'reset' sends a reset email; its UI is hidden while
 // the project has no SMTP, but the code path is kept.
 const signup=mode==='signup',reset=mode==='reset',recovery=mode==='recovery',change=mode==='new-password'||recovery;
 modal.innerHTML=`<button class="modal-close" data-close aria-label="Close sign in">${icon('close')}</button><span class="eyebrow">A LITTLE GROWTH, EVERYWHERE</span><h2 id="modal-title">${recovery?'Set a new password':change?'Change your password':reset?'Reset your password':signup?'Start your own journey':'Welcome back.'}</h2><p>${recovery?`Choose a new password of at least ${MIN_PASSWORD_LENGTH} characters for ${esc(auth?.user.email||'your account')}.`:change?`Enter your current password, then choose a new one of at least ${MIN_PASSWORD_LENGTH} characters for ${esc(auth?.user.email||'your account')}.`:reset?'We’ll send a password reset link to your email.':'Keep your lessons and reviews in sync on every device.'}</p><form class="auth-form" id="auth-form">${change?'':`<label class="field-label" for="auth-email">Email address</label><input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com">`}${change&&!recovery?`<label class="field-label" for="auth-current-password">Current password</label><input id="auth-current-password" type="password" autocomplete="current-password" required placeholder="Your current password">`:''}${reset?'':`<label class="field-label" for="auth-password">${change?'New password':'Password'}</label><input id="auth-password" type="password" autocomplete="${signup||change?'new-password':'current-password'}" ${signup||change?'minlength="8"':''} required placeholder="${signup||change?'At least 8 characters':'Your password'}">${change?`<label class="field-label" for="auth-password-confirm">Confirm new password</label><input id="auth-password-confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required placeholder="Type it again">`:''}`}<p id="auth-error" class="auth-error" role="alert"></p><button class="button primary full-width" id="auth-submit">${change?'Save new password':reset?'Send reset link':signup?'Create account':'Sign in'} ${icon('arrow')}</button></form><div class="auth-links">${change?'':`<button class="text-button" id="toggle-auth">${signup||reset?'Back to sign in':'Create an account'}</button>`}</div>${!change&&!signup&&!reset?'<p class="small-note forgot-note">Forgot your password? Ask the family admin to reset it.</p>':''}`;
 modal.showModal();$('[data-close]',modal).onclick=()=>modal.close();$('#toggle-auth')?.addEventListener('click',()=>openAccount(signup||reset?'signin':'signup'));$('#reset-auth')?.addEventListener('click',()=>openAccount('reset'));
 $('#auth-form').onsubmit=async e=>{
  e.preventDefault();if(!leaveSession())return;const submit=$('#auth-submit');submit.disabled=true;$('#auth-error').textContent='';
  try{
   const email=$('#auth-email')?.value.trim(),password=$('#auth-password')?.value,redirect=location.origin+location.pathname;
   if(reset){await cloud.requestPasswordReset(email,redirect);$('#auth-error').textContent='If this account exists, a reset link will be sent. Check your inbox and spam folder.';submit.disabled=false;return;}
   if(change){
    const current=$('#auth-current-password')?.value,confirmation=$('#auth-password-confirm')?.value;
    const invalid=recovery?validateNewPassword(password,confirmation):validatePasswordChange(current,password,confirmation);
    if(invalid){$('#auth-error').textContent=invalid;submit.disabled=false;return;}
    try{if(recovery)await cloud.updatePassword(password);else await cloud.changePassword(current,password);}
    catch(error){
     if(error.code==='CURRENT_PASSWORD_INVALID'){$('#auth-error').textContent='Current password is incorrect.';submit.disabled=false;$('#auth-current-password').value='';$('#auth-current-password').focus();return;}
     if(error.code!=='AUTH_REQUIRED')throw error;
     if(sync.state.profile){sync.state.error='Your session has expired. Please sign in again.';sync.state.errorCode='AUTH_REQUIRED';}
     render();toast('Your session has expired. Sign in again, then change your password.');openAccount('signin');
     if(!cloud.getSession())$('#auth-error').textContent='Your session has expired. Sign in again to change your password.';
     return;
    }
    modal.close();toast('Your password has been updated.');return;
   }
   if(signup){const result=await cloud.signUp(email,password,redirect);if(result.requiresEmailConfirmation){$('#auth-error').textContent='Check your email for a confirmation link, then return to sign in. If email delivery is not configured, ask the app owner to create your family account.';$('#auth-password').value='';submit.disabled=false;return;}}
   else await cloud.signIn(email,password);
   session=null;modal.close();await connectCloud();if(!sync.state.error)toast('You’re signed in. Your progress is connected.');
  }catch(error){$('#auth-error').textContent=error.message;submit.disabled=false;if(change)toast(error.message);}
 };
}
async function loadImages(paths){
 await Promise.all(paths.map(async path=>{try{const r=await fetch(path);const svg=r.ok?sanitizeSvg(await r.text()):null;images.set(path,svg?svgDataUrl(svg):null);}catch{images.set(path,null);}}));
}
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
window.addEventListener('storage',async e=>{
 if(e.key===AUTH_STORAGE_KEY){const userId=cloud.getSession()?.user.id;if(userId!==sync.state.profile?.id){session=null;sync.reset(userId||null);$('#modal').close();if(userId)await connectCloud();else render();}}
 if(e.key===KEY && !cloud.getSession()){state=readState();session=null;$('#modal').close();render();toast('Latest guest progress loaded from another tab.');}
});
window.addEventListener('focus',()=>{if(state&&cloud.getSession()&&!session&&!busy&&!sync.state.error)connectCloud();});
window.addEventListener('beforeunload',e=>{if(session && session.phase!=='done'){e.preventDefault();e.returnValue='';}});
setInterval(()=>{if(state && !session && view==='dashboard'&&!$('#modal').open)render();},60000);
try {
 curriculum=await loadCurriculum();
 items=curriculum.items;itemsById=new Map(items.map(i=>[i.id,i]));
 await loadImages(curriculum.imagePaths);
 window.__komorebi={levels:curriculum.levels.map(({level,status,itemCount})=>({level,status,itemCount})),mode:curriculum.mode,datasetVersion:curriculum.datasetVersion};
 state=readState();if(!savedRaw&&storageOK)persist(state);
 // Restore the view from #library/#guide/#settings. Supabase auth fragments are left for initializeFromUrl().
 const startView=viewFromHash(location.hash);if(startView)view=startView;
 historyCall('replaceState',{view},startView||!location.hash?urlForView(view):location.href);
 render();
 if(cloud.isConfigured){
  try{const incoming=await cloud.initializeFromUrl();if(cloud.getSession())await connectCloud();if(incoming?.recovery)openAccount('recovery');}
  catch(error){sync.state.error=error.message;sync.state.errorCode=error.code;render();toast(error.message);}
 }
} catch(error) {$('#app').innerHTML=`<div class="loading"><span class="brand-mark">木</span><h1>Let’s get your study space ready.</h1><p>${esc(error.message)}</p><p>Run this app through its local server or a web host, then reload.</p><button class="button primary" id="reload">Try again</button></div>`;$('#reload').onclick=()=>location.reload();}
