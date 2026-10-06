import { STAGE_NAMES, newProfile, availableLessons, dueReviews, startLearning, completeReview, statusFor, stats, toHiragana, checkAnswer } from './engine.mjs';

import { createCloudClient, AUTH_STORAGE_KEY, validateNewPassword, MIN_PASSWORD_LENGTH } from './cloud.mjs';
import { CLOUD_CONFIG } from './config.js';
const cloud = createCloudClient(CLOUD_CONFIG);
let cloudProfile = null, cloudRevision = 0, cloudError = '', cloudErrorCode = '', busy = false, pendingCloud = null;
const DRAFT_KEY = 'komorebi.cloud-draft.v1';
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
let items = [], state, savedRaw = null, storageOK = true, view = 'dashboard', filter = 'radical', search = '', session = null, toastTimer;
const guestProfile = () => state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
const profile = () => cloudProfile || guestProfile();
const getItem = id => items.find(i => i.id === id);
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
function validateProfile(value) {
 if(!value || typeof value.name!=='string' || !value.name.trim() || value.name.length>50 || !value.progress || typeof value.progress!=='object' || Array.isArray(value.progress)) throw Error('This is not a valid Komorebi backup.');
 const p=newProfile(value.name.trim(), typeof value.id==='string' ? value.id : undefined);
 p.createdAt=Number.isFinite(value.createdAt) ? value.createdAt : p.createdAt;
 p.settings={batchSize:[3,5,10].includes(value.settings?.batchSize) ? value.settings.batchSize : 5};
 const known = new Set(items.map(i=>i.id));
 for(const [id,entry] of Object.entries(value.progress)) {
  if(!known.has(id)) throw Error('This backup contains items from an unsupported level.');
  if(!entry || !Number.isInteger(entry.stage) || entry.stage<1 || entry.stage>9 || (entry.stage<9 && (!Number.isFinite(entry.availableAt) || entry.availableAt<0))) throw Error('This backup contains invalid review dates or stages.');
  p.progress[id]={stage:entry.stage,availableAt:entry.stage===9 ? null : entry.availableAt,startedAt:Number.isFinite(entry.startedAt)?entry.startedAt:Date.now(),lastReviewedAt:Number.isFinite(entry.lastReviewedAt)?entry.lastReviewedAt:null,correctReviews:Math.max(0,Number(entry.correctReviews)||0),incorrectReviews:Math.max(0,Number(entry.incorrectReviews)||0),...(Number.isFinite(entry.passedAt)?{passedAt:entry.passedAt}:{})};
 }
 p.history=Array.isArray(value.history) ? value.history.filter(h=>h && typeof h==='object' && Number.isFinite(h.at)).slice(-5000) : [];
 return p;
}
function persist(next) {
 if(!storageOK) { toast('Saving is unavailable. Export a backup before you close this tab.'); state=next; return true; }
 try {
  const current=localStorage.getItem(KEY);
  if(current!==savedRaw) { state=readState(); session=null; render(); toast('Progress changed in another tab. Your latest saved progress has been loaded. Please retry.'); return false; }
  const raw=JSON.stringify(next); localStorage.setItem(KEY,raw); savedRaw=raw; state=next; return true;
 } catch { storageOK=false; state=next; toast('Your browser could not save. Export a backup before closing.'); return true; }
}
async function updateProfile(p) {
 if (cloudProfile && cloud.getSession()?.user.id !== cloudProfile.id) {cloudError='Sign in again to save your cloud progress.';cloudErrorCode='AUTH_REQUIRED';render();return false;}
 if (!cloudProfile && !cloud.getSession()) return persist({...state,profiles:state.profiles.map(x=>x.id===p.id?p:x)});
 if (busy || cloudError) { toast('Resolve the cloud connection before making more changes.'); return false; }
 pendingCloud = {userId:cloud.getSession().user.id,profile:p,revision:cloudRevision};
 saveDraft();
 return pushCloudDraft();
}
function render() {
 const p=profile(), s=stats(items,p,Date.now());
 $('#app').innerHTML=`
 <aside class="sidebar">
  <a class="brand" href="#dashboard" aria-label="Komorebi dashboard"><span class="brand-mark">木</span><span>komorebi<small>YOUR DAILY JAPANESE</small></span></a>
  <div class="workspace-label">YOUR STUDY SPACE</div>
  <nav aria-label="Main navigation">
   ${[['dashboard','home','Dashboard'],['library','book','Study library'],['guide','leaf','How it works'],['settings','settings','Settings']].map(([id,i,label])=>`<button class="nav-link ${view===id?'active':''}" data-nav="${id}" ${view===id?'aria-current="page"':''}>${icon(i)}<span>${label}</span>${id==='dashboard'&&s.reviews?`<span class="nav-count">${s.reviews}</span>`:''}</button>`).join('')}
  </nav>
  <div class="sidebar-bottom"><div class="small-sprout">${icon('leaf')}</div><h3>A little, every day.</h3><p>A few quiet minutes can take you a long way.</p><div class="sidebar-line"></div><span class="local-indicator"></span> ${cloudProfile?(cloudError?'Cloud sync needs attention':'Synced to your account'):storageOK?'Guest progress on this device':'Saving unavailable'}</div>
 </aside>
 <div class="main-shell">
  <header class="topbar"><span class="breadcrumb">My learning <span>/</span> <strong>${session ? (session.mode==='lesson'?'Lessons':session.mode==='review'?'Reviews':'Practice') : {dashboard:'Dashboard',library:'Study library',guide:'How it works',settings:'Settings'}[view]}</strong></span><div class="header-actions"><span class="level-pill">LEVEL <b>01</b></span><button class="profile-button" data-action="profiles" aria-label="Your learner account"><span class="avatar">${esc(Array.from(p.name)[0].toUpperCase())}</span><span class="profile-name">${esc(p.name)}</span><span class="down-chevron">⌄</span></button></div></header>
  <main id="main" tabindex="-1">${accountBanner()}${!storageOK?'<div class="storage-warning">Your browser could not load or save progress. You can study, but export a backup before closing. Existing saved data has not been overwritten.</div>':''}${session?renderSession():view==='dashboard'?dashboard(s):view==='library'?library():view==='guide'?guide():settings()}</main>
  <footer><span>木漏れ日 <span class="footer-dot">·</span> Sunlight through the leaves.</span><span>Inspired by WaniKani <span class="footer-dot">·</span> Made for a little daily growth</span></footer>
 </div>`;
 bind();
 if(session?.phase==='quiz' && !session.feedback) requestAnimationFrame(()=>$('#answer')?.focus());
}
function dashboard(s) {
 const p=profile(), guru=items.filter(i=>i.type==='kanji' && (p.progress[i.id]?.passedAt || p.progress[i.id]?.stage>=5)).length;
 const allRadicals=items.filter(i=>i.type==='radical');
 const next=Object.values(p.progress).filter(x=>x.stage<9 && x.availableAt>Date.now()).sort((a,b)=>a.availableAt-b.availableAt)[0]?.availableAt;
 return `<section class="page-intro"><div><div class="eyebrow">THE EVERYDAY PRACTICE</div><h1>Your Japanese journey</h1><p>One character at a time. One step closer.</p></div><span class="date-label">${new Date().toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'})}</span></section>
 <section class="hero"><div class="hero-copy"><span class="hero-tag"><span></span> A GOOD DAY TO BEGIN</span><h2>Small steps.<br><em>Lasting knowledge.</em></h2><p>Build your foundation with radicals, bring kanji<br class="desktop-br"> to life, and make new words your own.</p><button class="button primary" data-action="lessons" ${s.lessons?'':'disabled'}>${s.learned?'Continue learning':'Let’s learn something'} ${icon('arrow')}</button><span class="hero-caption">${s.lessons ? `${Math.min(p.settings.batchSize,s.lessons)} small lessons. A little progress.`:'Your next lessons unlock as you review.'}</span></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><span class="art-word word-one">日</span><span class="art-word word-two">山</span><span class="art-word word-three">人</span><span class="tree-tile">木</span><svg class="botanical" viewBox="0 0 180 220"><path d="M88 215C111 161 78 92 114 19"/><path d="M96 172C34 168 37 124 88 130C103 151 96 172 96 172Z"/><path d="M98 130C162 128 158 84 114 91C97 110 98 130 98 130Z"/><path d="M97 85C58 77 65 40 102 54C109 71 97 85 97 85Z"/><path d="M113 41C155 36 146 9 122 15C113 26 113 41 113 41Z"/></svg><span class="vertical-japanese">毎日、少しずつ。</span><span class="art-note">a little growth, every day</span></div></section>
 <section class="action-grid" aria-label="Study actions"><button class="action-card lessons-card" data-action="lessons" ${s.lessons?'':'disabled'}><div class="action-icon">${icon('book')}</div><div class="action-text"><span>New lessons</span><strong>${s.lessons}<small>ready to discover</small></strong></div><span class="round-arrow">${icon('arrow')}</span></button><button class="action-card reviews-card" data-action="reviews" ${s.reviews?'':'disabled'}><div class="action-icon">${icon('clock')}</div><div class="action-text"><span>Your reviews</span><strong>${s.reviews}<small>${s.reviews?'ready to remember':next?`next ${timeUntil(next)}`:'start with a lesson'}</small></strong></div><span class="round-arrow">${icon('arrow')}</span></button></section>
 <div class="dashboard-grid"><div class="dashboard-primary"><section class="panel level-panel"><div class="panel-heading"><div><span class="eyebrow">BUILDING YOUR FOUNDATION</span><h2>Level 1 <span class="muted-japanese">始まり</span></h2></div><span class="subtle-badge">${s.learned} / 80 learned</span></div><div class="level-progress-label"><span>Kanji at Guru</span><strong>${guru} <span>/ 18</span></strong></div><div class="progress-track"><span style="width:${guru/18*100}%"></span></div><p class="progress-caption">Grow your radicals to Guru to unlock their kanji.</p><div class="type-tabs" role="group" aria-label="Subject type">${Object.entries(TYPES).map(([t,label])=>`<button data-filter="${t}" class="${t===filter?'selected':''}"><span class="type-dot ${t}"></span>${label}<span>${items.filter(i=>i.type===t).length}</span></button>`).join('')}</div><div class="subject-grid">${items.filter(i=>i.type===filter).map(i=>tile(i)).join('')}</div><div class="panel-foot"><div class="legend"><span class="legend-dot"></span> Available <span class="legend-dot locked"></span> Locked</div><button class="text-button" data-nav="library">Explore all subjects ${icon('arrow')}</button></div></section>
 <section class="panel growth-panel"><div class="panel-heading"><h2>Your growing knowledge</h2>${icon('leaf')}</div><div class="srs-grid">${[{name:'Apprentice',start:1,end:4},{name:'Guru',start:5,end:6},{name:'Master',start:7,end:7},{name:'Enlightened',start:8,end:8},{name:'Burned',start:9,end:9}].map((g,n)=>`<div class="srs-stat srs-${n}"><span class="srs-dot"></span><strong>${Object.values(p.progress).filter(x=>x.stage>=g.start&&x.stage<=g.end).length}</strong><span>${g.name}</span></div>`).join('')}</div></section></div>
 <aside class="dashboard-secondary"><section class="panel upcoming-panel"><div class="panel-heading"><h2>Coming up</h2>${icon('clock')}</div><span class="eyebrow">NEXT 24 HOURS</span>${upcoming(p)}<div class="quiet-note">${icon('leaf')}<span>${next?'A little space helps a memory take root.':'Finish your first lessons and your review schedule will grow here.'}</span></div></section><section class="path-card"><span class="eyebrow">THE LEARNING PATH</span><h2>Little pieces.<br>A bigger picture.</h2><div class="path-step"><span class="path-icon radical">亠</span><div><strong>Radicals</strong><p>The building blocks</p></div></div><div class="path-step"><span class="path-icon kanji">木</span><div><strong>Kanji</strong><p>Characters with meaning</p></div></div><div class="path-step"><span class="path-icon vocabulary">山川</span><div><strong>Vocabulary</strong><p>Words you can use</p></div></div><button class="text-button" data-nav="guide">How it all connects ${icon('arrow')}</button></section></aside></div>`;
}
function tile(item) {
 const st=statusFor(item,profile(),Date.now());
 return `<button class="subject-tile ${item.type} ${st.state==='locked'?'is-locked':''} ${st.stage>=5?'is-guru':''}" data-item="${esc(item.id)}" title="${esc(item.meaning)} · ${esc(st.state==='locked'?'Locked':st.stageName)}" aria-label="${esc(item.character)}, ${esc(item.meaning)}, ${esc(st.state==='locked'?'locked':st.stageName)}"><span lang="ja">${esc(item.character)}</span>${st.state==='locked'?icon('lock'):st.stage>=5?'<span class="tile-check">✓</span>':''}</button>`;
}
function upcoming(p) {
 const now=Date.now(), spans=[{label:'Now',min:-Infinity,max:0},{label:'In 4 hours',min:0,max:4},{label:'In 8 hours',min:4,max:8},{label:'Later today',min:8,max:24}];
 return `<div class="forecast">${spans.map((s,index)=>{const count=Object.values(p.progress).filter(x=>x.stage<9 && (x.availableAt-now)/36e5>s.min && (x.availableAt-now)/36e5<=s.max).length;return `<div class="forecast-row"><span>${s.label}</span><div class="forecast-track"><span style="width:${count?Math.max(12,count/80*100):0}%"></span></div><strong>${count}</strong></div>`;}).join('')}</div>`;
}
function library() {
 const filtered=items.filter(i=>(filter==='all'||i.type===filter) && `${i.character} ${i.meanings.join(' ')} ${i.readings.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
 return `<section class="page-intro"><div><div class="eyebrow">A PLACE TO EXPLORE</div><h1>Study library</h1><p>Get to know all 80 subjects in Level 1.</p></div><button class="button secondary" data-action="practice">${icon('play')} Free practice</button></section><section class="panel library-panel"><div class="library-toolbar"><div class="type-tabs">${[['all','All subjects'],...Object.entries(TYPES)].map(([t,l])=>`<button data-filter="${t}" class="${filter===t?'selected':''}">${l}</button>`).join('')}</div><label class="search-box"><span class="sr-only">Search subjects</span><input id="search" type="search" placeholder="Search characters or meanings…" value="${esc(search)}"></label></div><div class="library-list">${filtered.map(i=>{const st=statusFor(i,profile(),Date.now());return `<button class="library-row" data-item="${esc(i.id)}"><span class="library-character ${i.type}" lang="ja">${esc(i.character)}</span><span class="library-meaning"><strong>${esc(i.meaning)}</strong><small>${i.type==='radical'?'Radical · building block':esc(i.readings.join(' / '))}</small></span><span class="subject-label ${i.type}">${i.type}</span><span class="status-label">${st.state==='locked'?'Locked':st.state==='lesson'?'Ready to learn':esc(st.stageName)}</span>${icon('chevron')}</button>`}).join('')||'<div class="empty-state">No subjects found. Try a character, meaning, or reading.</div>'}</div></section><p class="page-note">Free practice explores the library without changing your review schedule.</p>`;
}
function guide() {
 return `<section class="page-intro"><div><div class="eyebrow">FAMILIAR RHYTHM, YOUR OWN PACE</div><h1>A little practice goes a long way.</h1><p>A learning loop inspired by the WaniKani process you know.</p></div></section><div class="guide-grid"><section class="panel guide-section"><span class="number-label">01</span><h2>Learn the little pieces</h2><p>Start with a small batch of radicals. Read the memory story, then prove you remember with a short quiz. Radicals only need a meaning; kanji and vocabulary need both a meaning and a reading.</p></section><section class="panel guide-section"><span class="number-label">02</span><h2>Give your memory some space</h2><p>After you finish a lesson quiz, the item enters Apprentice. Your first review appears in 2 hours. Correct reviews gradually increase the time before you see it again. Misses lower the stage and bring it back sooner.</p></section><section class="panel guide-section"><span class="number-label">03</span><h2>Build on what you remember</h2><p>When a radical reaches Guru, it can unlock kanji that use it. Guru kanji unlock vocabulary. Once a building block has reached Guru, its unlock stays earned even if its stage later drops.</p></section><section class="panel guide-section"><span class="number-label">04</span><h2>Make it a family habit</h2><p>Each learner has separate progress. Sign in with your email and password to save progress to your account and continue on another device. Guest profiles stay in this browser. Export a backup from Settings whenever you want an extra copy.</p></section></div><section class="panel schedule-panel"><h2>The review rhythm</h2><p>We use the faster Level 1–2 timing. Each label shows the wait at that stage.</p><div class="schedule-flow">${['Apprentice 1|2 hours','Apprentice 2|4 hours','Apprentice 3|8 hours','Apprentice 4|1 day','Guru 1|1 week','Guru 2|2 weeks','Master|30 days','Enlightened|120 days','Burned|Remembered'].map(t=>{const [n,d]=t.split('|');return `<div><strong>${n}</strong><span>${d}</span></div>`}).join('')}</div><p class="page-note">This is an independent study app, not an official WaniKani client. Level 2 is planned; the first version focuses on a complete Level 1.</p><a class="text-button" href="https://knowledge.wanikani.com/wanikani/getting-started/" target="_blank" rel="noopener noreferrer">WaniKani’s learning guide ${icon('arrow')}</a></section>`;
}
function settings() {
 const p=profile();
 return `<section class="page-intro"><div><div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your study space</h1><p>A pace that fits you, and progress that stays yours.</p></div></section><div class="settings-grid"><section class="panel settings-section"><h2>Learner profile</h2><p>${cloudProfile?'Your account keeps your lessons and reviews in sync.':'Guest profiles have separate progress on this browser.'}</p><label class="field-label" for="profile-name">Your name</label><form id="rename-form" class="inline-form"><input id="profile-name" required maxlength="40" value="${esc(p.name)}"><button class="button secondary">Save name</button></form><button class="text-button" data-action="profiles">${icon('people')} ${cloudProfile?'Manage account':'Manage guest learners'}</button><hr><h2>Lesson size</h2><p>Choose how many new subjects to learn in one sitting.</p><div class="batch-options">${[3,5,10].map(n=>`<button class="${p.settings.batchSize===n?'selected':''}" data-batch="${n}">${n}<small>subjects</small></button>`).join('')}</div></section><section class="panel settings-section"><h2>Keep your progress safe</h2><p>${cloudProfile?'Your progress is saved to your cloud account after each completed lesson batch or review item. A backup gives you an extra copy.':'You’re using a guest profile. Progress lives in this browser until you sign in and transfer it to an empty account.'}</p>${cloudProfile?`<div class="cloud-account">${icon('check')}<span><strong>${esc(cloud.getSession()?.user.email||'Your account')}</strong><small>${cloudError?'Sync needs attention':'Cloud progress connected'}</small></span></div><button class="text-button" data-action="change-password">${icon('lock')} Change password</button>`:`<button class="button secondary full-width" data-action="account">${icon('people')} Sign in to sync progress</button>`}<button class="button primary full-width" data-action="export">${icon('download')} Export my progress</button><label class="button secondary full-width import-label">Import a backup<input id="import-file" type="file" accept=".json,application/json" class="sr-only"></label><p class="small-note">${cloudProfile?'Import is available for an empty cloud account. Existing cloud progress is never replaced by an import.':'Importing adds a new guest profile. Sign in to an empty account to transfer your guest progress to the cloud.'}</p><hr><h2>About this little space</h2><p>Komorebi (木漏れ日) means sunlight filtering through leaves. Our first chapter includes 25 radicals, 18 kanji, and 37 vocabulary words.</p><p class="small-note">Study explanations are from your supplied WaniKani export. WaniKani is a trademark of Tofugu LLC. This app is independent and unaffiliated.</p></section></div>`;
}
function subjectDetails(item, context='detail') {
 const st=statusFor(item,profile(),Date.now());
 return `<div class="subject-banner ${item.type}"><span class="subject-kind">${item.type} <span>•</span> LEVEL 1</span><div class="big-character" lang="ja">${esc(item.character)}</div><h2>${esc(item.meaning)}</h2>${item.readings.length?`<p class="banner-reading" lang="ja">${esc(item.readings.join(' ・ '))}</p>`:''}</div><div class="subject-content"><section><span class="eyebrow">MEANING</span><h3>${esc(item.meanings.join(' · '))}</h3><p>${esc(item.meaningMnemonic)||'Look closely at the character and connect its shape with its meaning.'}</p></section>${item.type!=='radical'?`<section><span class="eyebrow">READING</span><h3 lang="ja">${esc(item.readings.join(' ・ '))}</h3><p>${esc(item.readingMnemonic)}</p>${item.otherReadings?.length?`<p class="small-note">Other kanji readings: <span lang="ja">${esc(item.otherReadings.join(' ・ '))}</span>. The quiz asks for the reading taught above.</p>`:''}</section>`:''}${item.components?.length?`<section><span class="eyebrow">BUILDING BLOCKS</span><div class="component-list">${item.components.map(c=>`<span><b lang="ja">${esc(c.character)}</b>${esc(c.name)}</span>`).join('')}</div></section>`:''}${item.sentences?.length?`<section><span class="eyebrow">IN CONTEXT</span>${item.sentences.slice(-3).map(s=>`<div class="sentence"><p lang="ja">${esc(s.japanese)}</p><small>${esc(s.english)}</small></div>`).join('')}</section>`:''}${context==='detail'?`<section class="subject-status"><strong>${st.state==='locked'?'Not unlocked yet':st.state==='lesson'?'Ready for your lessons':esc(st.stageName)}</strong><p>${st.state==='locked'?`First reach Guru with: ${st.unmetDependencies.map(id=>esc(getItem(typeof id==='string'?id:id.id)?.meaning || id)).join(', ')}.`:st.availableAt?`Next review: ${prettyDate(st.availableAt)}`:'Every small step counts.'}</p></section>`:''}<a class="source-link" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">View the original on WaniKani ↗</a></div>`;
}
function openSubject(id) {
 const item=getItem(id); if(!item)return;
 const modal=$('#modal');modal.className='subject-dialog';modal.innerHTML=`<button class="modal-close" data-close aria-label="Close subject">${icon('close')}</button><span id="modal-title" class="sr-only">${esc(item.meaning)} details</span>${subjectDetails(item)}`;modal.showModal(); $('[data-close]',modal).onclick=()=>modal.close();
}
function openProfiles() {
 if (cloud.getSession()) { openAccount(); return; }
 const modal=$('#modal');modal.className='profiles-dialog';modal.innerHTML=`<button class="modal-close" data-close aria-label="Close profiles">${icon('close')}</button><span class="eyebrow">YOUR FAMILY’S STUDY SPACE</span><h2 id="modal-title">Who’s learning today?</h2><p>Separate progress for every learner on this browser.</p><div class="profile-list">${state.profiles.map(p=>`<button data-profile="${esc(p.id)}"><span class="avatar">${esc(Array.from(p.name)[0].toUpperCase())}</span><span><strong>${esc(p.name)}</strong><small>${Object.keys(p.progress).length} subjects learned</small></span>${p.id===profile().id?icon('check'):icon('chevron')}</button>`).join('')}</div><form id="add-profile"><label class="field-label" for="new-name">Add a learner</label><div class="inline-form"><input id="new-name" placeholder="Your brother’s name" required maxlength="40"><button class="button primary">${icon('plus')} Add</button></div></form><p class="small-note">These are guest profiles on this browser. For accounts that sync across devices, sign in.</p><button class="button secondary full-width" id="guest-signin">Sign in to your account</button>`;modal.showModal();$('[data-close]',modal).onclick=()=>modal.close();
 $('#guest-signin').onclick=()=>{modal.close();openAccount();};
 modal.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{if(!leaveSession())return;if(persist({...state,activeProfileId:b.dataset.profile})){session=null;modal.close();render();}});
 $('#add-profile',modal).onsubmit=e=>{e.preventDefault();if(!leaveSession())return;const name=$('#new-name').value.trim();if(!name)return;const p=newProfile(name);if(persist({...state,activeProfileId:p.id,profiles:[...state.profiles,p]})){session=null;modal.close();render();toast(`Welcome, ${name}. Your journey starts here.`);}};
}
function leaveSession(){return !session || session.phase==='done' || window.confirm('Leave this session? Completed review items are saved. An unfinished lesson batch or review item will need to be repeated.');}
function begin(mode) {
 if (busy || (cloudProfile && cloudError)) {toast('Resolve cloud sync first so your progress can be saved safely.');return;}
 const p=profile();let selected=mode==='lesson'?availableLessons(items,p).slice(0,p.settings.batchSize):mode==='review'?dueReviews(items,p,Date.now()):items.filter(i=>(filter==='all'||i.type===filter)&&`${i.character} ${i.meanings.join(' ')}`.toLowerCase().includes(search.toLowerCase())).slice(0,10);
 if(!selected.length){toast(mode==='review'?'You’re all caught up. Come back when reviews are due.':'No subjects are available for this session.');return;}
 session={mode,phase:mode==='lesson'?'learn':'quiz',selected,position:0,queue:[],mistakes:{},finished:[],feedback:null,answers:0,correct:0,startedAt:Date.now()};
 if(mode!=='lesson')makeQuiz();render();window.scrollTo(0,0);
}
function makeQuiz(){session.phase='quiz';session.queue=session.selected.flatMap(i=>[{id:i.id,kind:'meaning'},...(i.type==='radical'?[]:[{id:i.id,kind:'reading'}])]);session.totalQuestions=session.queue.length;}
function renderSession() {
 const s=session;
 if(s.phase==='done')return `<section class="session-done"><div class="done-icon">${icon('check')}</div><span class="eyebrow">A LITTLE MORE THAN YESTERDAY</span><h1>${s.mode==='lesson'?'A new beginning.':s.mode==='practice'?'Practice makes progress.':'Nicely remembered.'}</h1><p>${s.mode==='lesson'?`${s.selected.length} subjects planted in your memory. Your first reviews arrive in 2 hours.`:s.mode==='practice'?'A little extra practice, with your review schedule unchanged.':`${s.finished.length} subjects reviewed. Your next review times are saved.`}</p><div class="result-cards"><div><strong>${s.mode==='lesson'?s.selected.length:s.finished.length}</strong><span>subjects ${s.mode==='lesson'?'learned':'completed'}</span></div><div><strong>${s.answers?Math.round(s.correct/s.answers*100):100}%</strong><span>answer accuracy</span></div></div><button class="button primary" data-action="finish">Back to your dashboard ${icon('arrow')}</button></section>`;
 const learning=s.phase==='learn', item=learning?s.selected[s.position]:getItem(s.queue[0].id), kind=learning?'':s.queue[0].kind;
 const complete=learning?s.position:s.totalQuestions-s.queue.length;
 return `<section class="session-header"><button class="text-button" data-action="exit-session">${icon('back')} Dashboard</button><span>${s.mode==='lesson'?'New lessons':s.mode==='review'?'Spaced reviews':'Free practice'} <b>·</b> ${learning?`${s.position+1} of ${s.selected.length}`:`${s.finished.length} of ${s.selected.length} subjects`}</span></section><div class="session-progress"><span style="width:${learning?s.position/s.selected.length*100:s.finished.length/s.selected.length*100}%"></span></div>${learning?`<section class="lesson-card">${subjectDetails(item,'lesson')}<div class="lesson-controls"><button class="button secondary" data-action="previous-lesson" ${s.position===0?'disabled':''}>${icon('back')} Previous</button><span>${s.position+1} / ${s.selected.length}</span><button class="button primary" data-action="next-lesson">${s.position===s.selected.length-1?'Start the quiz':'Next subject'} ${icon('arrow')}</button></div></section>`:`<section class="quiz-card"><div class="quiz-prompt ${item.type}"><span class="subject-kind">${item.type} <span>•</span> ${kind==='meaning'?'MEANING':'READING'}</span><div class="quiz-character" lang="ja">${esc(item.character)}</div></div><div class="quiz-body"><h1>${kind==='meaning'?'What does this mean?':'How do you read this?'}</h1><p>${kind==='meaning'?'Enter an English meaning.':item.type==='kanji'?'Enter the reading you learned for this kanji.':'Enter this word’s reading in kana or romaji.'}</p><form id="answer-form"><label class="sr-only" for="answer">${kind==='meaning'?'Meaning in English':'Reading in kana or romaji'}</label><input id="answer" class="answer-input ${s.feedback?s.feedback.correct?'correct':s.feedback.retry?'retry':'incorrect':''}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${kind==='meaning'?'Your answer…':'かな or romaji…'}" ${s.feedback?'disabled':''} value="${esc(s.feedback?.answer||'')}"><div id="kana-preview" class="kana-preview" lang="ja">${kind==='reading'?'Romaji is converted to hiragana when you answer.':'Press Enter to check your answer.'}</div>${s.feedback?`<div class="answer-feedback ${s.feedback.correct?'correct':s.feedback.retry?'retry':'incorrect'}" role="status"><strong>${s.feedback.correct?'That’s right!':s.feedback.retry?'Another reading—try the one taught here.':'Not quite. Let’s try it again.'}</strong><span>${s.feedback.correct?`${esc(item.meaning)}${item.readings.length?' · '+esc(item.readings.join(' / ')):''}`:s.feedback.retry?esc(s.feedback.message||'Use the reading taught in the lesson.'):`Answer: ${esc(kind==='meaning'?item.meanings.join(' / '):item.readings.join(' / '))}`}</span></div><button type="button" class="button primary full-width" data-action="continue-answer">Continue ${icon('arrow')}</button>${!s.feedback.correct&&!s.feedback.retry?`<details class="answer-explanation"><summary>Revisit the memory story</summary><p>${esc(kind==='meaning'?item.meaningMnemonic:item.readingMnemonic)}</p></details>`:''}`:`<button class="button primary full-width" type="submit">Check answer ${icon('arrow')}</button><button class="text-button dont-know" type="button" data-action="dont-know">I don’t remember yet</button>`}</form></div></section><p class="session-footnote">${s.mode==='practice'?'Just practice. Your spaced review progress will stay the same.':s.mode==='lesson'?'You’ll recall every answer correctly before these lessons are saved.':'Both meaning and reading must be recalled before an item is complete.'}</p>`}`;
}
function submitAnswer(unknown=false) {
 if(!session||session.phase!=='quiz'||session.feedback)return;
 const q=session.queue[0],item=getItem(q.id),answer=$('#answer').value.trim();
 if(!unknown&&!answer){toast('Enter an answer, or choose “I don’t remember yet”.');return;}
 const result=unknown?{correct:false}:checkAnswer(item,q.kind,answer);
 if(!result.retry){session.answers++;if(result.correct)session.correct++;else session.mistakes[item.id]=(session.mistakes[item.id]||0)+1;}
 session.feedback={...result,answer:unknown?'':answer};render();requestAnimationFrame(()=>$('[data-action="continue-answer"]')?.focus());
}
async function continueAnswer(){
 if(!session?.feedback||busy)return;
 const s=structuredClone(session);
 if(!s.feedback.retry){
  const q=s.queue.shift();if(!s.feedback.correct)s.queue.push(q);
  if(!s.queue.some(x=>x.id===q.id) && !s.finished.includes(q.id)) {
   if(s.mode==='review' && !await updateProfile(completeReview(profile(),q.id,{mistakes:s.mistakes[q.id]||0},Date.now())))return;
   s.finished.push(q.id);
  }
 }
 s.feedback=null;
 if(!s.queue.length){if(s.mode==='lesson'&&!await updateProfile(startLearning(profile(),s.selected.map(i=>i.id),Date.now())))return;s.phase='done';}
 session=s;render();
}
function exportProgress(){const blob=new Blob([JSON.stringify({app:'komorebi',version:1,exportedAt:new Date().toISOString(),profile:profile()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`komorebi-${profile().name.replace(/[^a-z0-9_-]/gi,'-')}-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your progress backup is ready.');}
async function importProgress(file){if(!file)return;try{if(file.size>2000000)throw Error('Please choose a Komorebi backup smaller than 2 MB.');const data=JSON.parse(await file.text());if(data.app!=='komorebi'||data.version!==1)throw Error('Please choose a Komorebi progress backup.');const p=validateProfile(data.profile);if(cloud.getSession()){if(Object.keys(profile().progress).length)throw Error('Import is only available for an empty cloud account. Export the existing progress first.');p.id=cloud.getSession().user.id;if(await updateProfile(p)){render();toast('Backup saved to your cloud account.');}return;}p.id=crypto.randomUUID();p.name=p.name.slice(0,38)+' (imported)';if(persist({...state,activeProfileId:p.id,profiles:[...state.profiles,p]})){render();toast('Backup imported as a new learner profile.');}}catch(error){toast(error.message||'That backup could not be imported. Your progress is unchanged.');}}
function bind(){
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{if(!leaveSession())return;session=null;view=b.dataset.nav;if(view==='dashboard'&&filter==='all')filter='radical';render();window.scrollTo(0,0);});
 $('.brand').onclick=e=>{e.preventDefault();if(!leaveSession())return;session=null;view='dashboard';if(filter==='all')filter='radical';render();};
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});
 document.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>openSubject(b.dataset.item));
 document.querySelectorAll('[data-batch]').forEach(b=>b.onclick=async()=>{if(await updateProfile({...profile(),settings:{...profile().settings,batchSize:Number(b.dataset.batch)}}))render();});
 document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
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
  if(action==='export')exportProgress();
  if(action==='next-lesson'){if(session.position<session.selected.length-1)session.position++;else makeQuiz();render();window.scrollTo(0,0);}
  if(action==='previous-lesson'&&session.position>0){session.position--;render();window.scrollTo(0,0);}
  if(action==='continue-answer')continueAnswer();
  if(action==='dont-know')submitAnswer(true);
  if(action==='finish'||action==='exit-session'){if(action==='exit-session'&&!leaveSession())return;session=null;view='dashboard';render();window.scrollTo(0,0);}
 });
 if($('#answer-form'))$('#answer-form').onsubmit=e=>{e.preventDefault();submitAnswer();};
 if($('#answer')&&session.queue[0]?.kind==='reading')$('#answer').oninput=e=>{$('#kana-preview').textContent=e.target.value?toHiragana(e.target.value):'Romaji is converted to hiragana when you answer.';};
 if($('#search'))$('#search').oninput=e=>{const pos=e.target.selectionStart;search=e.target.value;render();$('#search').focus();try{$('#search').setSelectionRange(pos,pos);}catch{}};
 if($('#rename-form'))$('#rename-form').onsubmit=async e=>{e.preventDefault();const name=$('#profile-name').value.trim();if(name&&await updateProfile({...profile(),name})){render();toast('Your name has been updated.');}};
 if($('#import-file'))$('#import-file').onchange=e=>importProgress(e.target.files[0]);
}
function accountBanner(){
 if(cloudProfile&&cloudError)return `<div class="cloud-banner error" role="alert"><span>${esc(cloudError)} ${pendingCloud?'Your unsynced progress is kept on this device.':''}</span><div class="auth-links"><button class="text-button" data-action="retry-cloud">${cloudErrorCode==='AUTH_REQUIRED'?'Sign in again':'Retry'}</button>${pendingCloud?'<button class="text-button" data-action="export">Export backup</button><button class="text-button" data-action="reload-cloud">Load cloud copy</button>':''}</div></div>`;
 if(cloudProfile){return !Object.keys(cloudProfile.progress).length&&Object.keys(guestProfile().progress).length?`<div class="cloud-banner"><span>You have ${Object.keys(guestProfile().progress).length} subjects in your guest profile. Bring them into this empty account.</span><button class="text-button" data-action="upload-guest">Transfer guest progress ${icon('arrow')}</button></div>`:'';}
 return `<div class="cloud-banner"><span>${cloud.isConfigured?'Guest mode · Sign in to keep your progress in sync across devices.':'Guest preview · Cloud accounts haven’t been connected yet.'}</span><button class="text-button" data-action="account">${cloud.isConfigured?'Sign in':'About accounts'} ${icon('arrow')}</button></div>`;
}
function setBusy(value,message='Saving your progress…'){
 busy=value;document.querySelector('.busy-cover')?.remove();
 if(value){const el=document.createElement('div');el.className='busy-cover';el.setAttribute('role','status');el.innerHTML=`<span>${esc(message)}</span>`;document.body.appendChild(el);}
}
function saveDraft(){try{if(pendingCloud)localStorage.setItem(DRAFT_KEY+':'+pendingCloud.userId,JSON.stringify(pendingCloud));}catch{toast('Unsynced progress could not be backed up on this device. Export it before closing.');}}
function clearDraft(userId){try{localStorage.removeItem(DRAFT_KEY+':'+userId);}catch{}pendingCloud=null;}
async function connectCloud(){
 if(busy)return;const auth=cloud.getSession();if(!auth){cloudProfile=null;render();return;}
 setBusy(true,'Loading your study space…');
 try{
  const record=await cloud.loadProfile();
  const p=record?validateProfile(record.profile):newProfile(auth.user.email?.split('@')[0]||'Learner',auth.user.id);p.id=auth.user.id;
  cloudProfile=p;cloudRevision=record?.revision||0;cloudError='';cloudErrorCode='';
  let draft;try{draft=JSON.parse(localStorage.getItem(DRAFT_KEY+':'+auth.user.id)||'null');}catch{}
  if(draft?.userId===auth.user.id&&Number.isInteger(draft.revision)&&draft.revision>=0){
   pendingCloud={userId:auth.user.id,profile:validateProfile(draft.profile),revision:draft.revision};pendingCloud.profile.id=auth.user.id;cloudProfile=pendingCloud.profile;
   cloudError='Some progress from a previous visit still needs to be synced.';cloudErrorCode='PENDING';
  }
 }catch(error){cloudError=error.message;cloudErrorCode=error.code;cloudProfile ||= newProfile(auth.user.email?.split('@')[0]||'Learner',auth.user.id);}
 finally{setBusy(false);render();}
}
async function pushCloudDraft(){
 if(!pendingCloud||busy)return false;const draft=structuredClone(pendingCloud);setBusy(true);
 try{
  const result=await cloud.saveProfile(draft.profile,draft.revision);
  cloudProfile=validateProfile(result.profile);cloudProfile.id=draft.userId;cloudRevision=result.revision;cloudError='';cloudErrorCode='';clearDraft(draft.userId);return true;
 }catch(error){
  if(!cloud.getSession()||cloud.getSession()?.user.id===draft.userId){cloudProfile=draft.profile;cloudError=error.message;cloudErrorCode=error.code;}
  session=null;render();toast('Progress needs your attention before you continue.');return false;
 }finally{setBusy(false);}
}
async function retryCloud(){if(cloudErrorCode==='AUTH_REQUIRED'||!cloud.getSession()){openAccount();return;}if(pendingCloud){await pushCloudDraft();render();}else await connectCloud();}
async function reloadCloud(){if(pendingCloud&&!window.confirm('Load the latest cloud copy and discard this device’s unsynced changes? Export a backup first if you want to keep both.'))return;const id=cloud.getSession()?.user.id;if(id)clearDraft(id);session=null;await connectCloud();}
async function uploadGuest(){if(busy||!cloudProfile||Object.keys(cloudProfile.progress).length)return;const p={...structuredClone(guestProfile()),id:cloud.getSession().user.id};if(await updateProfile(p)){render();toast('Your guest progress is now saved to your account.');}}
function openAccount(mode='signin'){
 const modal=$('#modal');if(modal.open)modal.close();modal.className='auth-dialog';
 const auth=cloud.getSession();
 if(!cloud.isConfigured){
  modal.innerHTML=`<button class="modal-close" data-close aria-label="Close accounts">${icon('close')}</button><span class="eyebrow">YOUR PROGRESS, WHEREVER YOU ARE</span><h2 id="modal-title">One account. Your own journey.</h2><p>Email/password accounts will keep each learner’s progress separate and let you continue on another device.</p><div class="auth-note">Cloud accounts are waiting for the app owner to connect the backend. You can try the full Level 1 learning flow with a guest profile today.</div><button class="button primary full-width" id="continue-guest">Continue as a guest ${icon('arrow')}</button>`;
  modal.showModal();$('[data-close]',modal).onclick=()=>modal.close();$('#continue-guest').onclick=()=>modal.close();return;
 }
 if(mode==='new-password'&&!auth){toast('Sign in to change your password.');mode='signin';}
 if(auth&&mode!=='new-password'){
  modal.innerHTML=`<button class="modal-close" data-close aria-label="Close account">${icon('close')}</button><span class="eyebrow">YOUR OWN STUDY SPACE</span><h2 id="modal-title">${esc(profile().name)}</h2><p>${esc(auth.user.email)}</p><div class="auth-note">${cloudError?esc(cloudError):'Your completed lessons and reviews are saved to this account. Sign in with the same email on another device to continue.'}</div><button class="button secondary full-width" id="refresh-cloud">Refresh from cloud</button><button class="button secondary full-width" id="cloud-export">Export progress backup</button><button class="button secondary full-width" id="change-password">${icon('lock')} Change password</button><button class="button primary full-width" id="signout">Sign out on this device</button><p id="auth-error" class="auth-error" role="alert"></p>`;
  modal.showModal();$('[data-close]',modal).onclick=()=>modal.close();$('#cloud-export').onclick=exportProgress;$('#change-password').onclick=()=>openAccount('new-password');$('#refresh-cloud').onclick=async()=>{if(!leaveSession())return;modal.close();await reloadCloud();};
  $('#signout').onclick=async()=>{if(!leaveSession())return;if(pendingCloud){$('#auth-error').textContent='Sync or export your pending progress before signing out.';return;}$('#signout').disabled=true;try{await cloud.signOut();cloudProfile=null;cloudRevision=0;cloudError='';session=null;modal.close();render();toast('Signed out. Your cloud progress is safe.');}catch(error){$('#auth-error').textContent=error.message;$('#signout').disabled=false;}};return;
 }
 const signup=mode==='signup',reset=mode==='reset',change=mode==='new-password';
 modal.innerHTML=`<button class="modal-close" data-close aria-label="Close sign in">${icon('close')}</button><span class="eyebrow">A LITTLE GROWTH, EVERYWHERE</span><h2 id="modal-title">${change?'Set a new password':reset?'Reset your password':signup?'Start your own journey':'Welcome back.'}</h2><p>${change?`Choose a new password of at least ${MIN_PASSWORD_LENGTH} characters for ${esc(auth?.user.email||'your account')}.`:reset?'We’ll send a password reset link to your email.':'Keep your lessons and reviews in sync on every device.'}</p><form class="auth-form" id="auth-form">${change?'':`<label class="field-label" for="auth-email">Email address</label><input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com">`}${reset?'':`<label class="field-label" for="auth-password">${change?'New password':'Password'}</label><input id="auth-password" type="password" autocomplete="${signup||change?'new-password':'current-password'}" ${signup||change?'minlength="8"':''} required placeholder="${signup||change?'At least 8 characters':'Your password'}">${change?`<label class="field-label" for="auth-password-confirm">Confirm new password</label><input id="auth-password-confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required placeholder="Type it again">`:''}`}<p id="auth-error" class="auth-error" role="alert"></p><button class="button primary full-width" id="auth-submit">${change?'Save new password':reset?'Send reset link':signup?'Create account':'Sign in'} ${icon('arrow')}</button></form><div class="auth-links">${change?'':`<button class="text-button" id="toggle-auth">${signup||reset?'Back to sign in':'Create an account'}</button>${!signup&&!reset?'<button class="text-button" id="reset-auth">Forgot password?</button>':''}`}</div>`;
 modal.showModal();$('[data-close]',modal).onclick=()=>modal.close();$('#toggle-auth')?.addEventListener('click',()=>openAccount(signup||reset?'signin':'signup'));$('#reset-auth')?.addEventListener('click',()=>openAccount('reset'));
 $('#auth-form').onsubmit=async e=>{
  e.preventDefault();if(!leaveSession())return;const submit=$('#auth-submit');submit.disabled=true;$('#auth-error').textContent='';
  try{
   const email=$('#auth-email')?.value.trim(),password=$('#auth-password')?.value,redirect=location.origin+location.pathname;
   if(reset){await cloud.requestPasswordReset(email,redirect);$('#auth-error').textContent='If this account exists, a reset link will be sent. Check your inbox and spam folder.';submit.disabled=false;return;}
   if(change){
    const invalid=validateNewPassword(password,$('#auth-password-confirm')?.value);
    if(invalid){$('#auth-error').textContent=invalid;submit.disabled=false;return;}
    try{await cloud.updatePassword(password);}
    catch(error){
     if(error.code!=='AUTH_REQUIRED')throw error;
     if(cloudProfile){cloudError='Your session has expired. Please sign in again.';cloudErrorCode='AUTH_REQUIRED';}
     render();toast('Your session has expired. Sign in again, then change your password.');openAccount('signin');
     if(!cloud.getSession())$('#auth-error').textContent='Your session has expired. Sign in again to change your password.';
     return;
    }
    modal.close();toast('Your password has been updated.');return;
   }
   if(signup){const result=await cloud.signUp(email,password,redirect);if(result.requiresEmailConfirmation){$('#auth-error').textContent='Check your email for a confirmation link, then return to sign in. If email delivery is not configured, ask the app owner to create your family account.';$('#auth-password').value='';submit.disabled=false;return;}}
   else await cloud.signIn(email,password);
   session=null;modal.close();await connectCloud();if(!cloudError)toast('You’re signed in. Your progress is connected.');
  }catch(error){$('#auth-error').textContent=error.message;submit.disabled=false;if(change)toast(error.message);}
 };
}
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
window.addEventListener('storage',async e=>{
 if(e.key===AUTH_STORAGE_KEY){const userId=cloud.getSession()?.user.id;if(userId!==cloudProfile?.id){session=null;cloudProfile=null;pendingCloud=null;cloudError='';$('#modal').close();if(userId)await connectCloud();else render();}}
 if(e.key===KEY && !cloud.getSession()){state=readState();session=null;$('#modal').close();render();toast('Latest guest progress loaded from another tab.');}
});
window.addEventListener('focus',()=>{if(state&&cloud.getSession()&&!session&&!busy&&!cloudError)connectCloud();});
window.addEventListener('beforeunload',e=>{if(session && session.phase!=='done'){e.preventDefault();e.returnValue='';}});
setInterval(()=>{if(state && !session && view==='dashboard'&&!$('#modal').open)render();},60000);
try {
 const response=await fetch('./data/level-1.json');if(!response.ok)throw Error('Study data could not be loaded.');
 const data=await response.json();items=Array.isArray(data)?data:data.items;
 if(!Array.isArray(items)||items.length!==80)throw Error('Level 1 data is incomplete.');
 state=readState();if(!savedRaw&&storageOK)persist(state);render();
 if(cloud.isConfigured){
  try{const incoming=await cloud.initializeFromUrl();if(cloud.getSession())await connectCloud();if(incoming?.recovery)openAccount('new-password');}
  catch(error){cloudError=error.message;cloudErrorCode=error.code;render();toast(error.message);}
 }
} catch(error) {$('#app').innerHTML=`<div class="loading"><span class="brand-mark">木</span><h1>Let’s get your study space ready.</h1><p>${esc(error.message)}</p><p>Run this app through its local server or a web host, then reload.</p><button class="button primary" id="reload">Try again</button></div>`;$('#reload').onclick=()=>location.reload();}
