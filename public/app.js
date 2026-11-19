/* ══════════════════════════════════════════════════════════════
   Survey Sathi — Firebase Auth + Firestore
   ══════════════════════════════════════════════════════════════ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => el.querySelectorAll(s);

/* ── Route ── */
function getRoute() {
  const p = location.pathname;
  if (p.startsWith('/survey/')) return { page: 'public', surveyId: decodeURIComponent(p.split('/survey/')[1]) };
  if (p === '/admin/login') return { page: 'login' };
  if (p === '/admin/register') return { page: 'register' };
  if (p === '/admin' || p.startsWith('/admin/')) return { page: 'admin' };
  return { page: 'landing' };
}
function navigate(path) { history.pushState(null, '', path); render(); }
window.addEventListener('popstate', () => render());

/* ── Icons ── */
const icons = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m6 9 6 6 6-6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11v6M9 14h6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
};
const questionTypes = { text: 'Text input', single: 'Single select', checkbox: 'Checkboxes', rating: 'Rating 1–5' };

/* ── State ── */
let state = {
  view: 'landing',
  user: null,         // Firebase user
  survey: null,       // Currently loaded survey doc
  surveys: [],        // List of surveys (admin)
  answers: {},
  errors: {},
  submitted: false,
  landingError: null,
  loading: true
};

/* ── Helpers ── */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const freshQuestion = type => ({
  id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  type, label: 'Untitled question', required: false,
  ...((['single', 'checkbox'].includes(type)) ? { options: ['Option 1', 'Option 2'] } : {})
});

/* ══════════════════════════════════════════════════════════════
   FIRESTORE HELPERS
   ══════════════════════════════════════════════════════════════ */
async function fetchSurveys() {
  if (!state.user) return [];
  try {
    // Only query surveys authored by this admin
    const snap = await db.collection('surveys')
      .where('authorId', '==', state.user.uid)
      .get();
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Backwards compatibility for primary account:
    // If legacy surveys without authorId exist, claim them for this creator
    if (state.user.email === 'aadarshapandit@gmail.com') {
      try {
        const legacySnap = await db.collection('surveys').get();
        for (const d of legacySnap.docs) {
          const data = d.data();
          if (!data.authorId && !list.find(x => x.id === d.id)) {
            await db.collection('surveys').doc(d.id).set({
              authorId: state.user.uid,
              authorEmail: state.user.email
            }, { merge: true });
            list.push({ id: d.id, ...data, authorId: state.user.uid, authorEmail: state.user.email });
          }
        }
      } catch (_) {}
    }

    list.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
      const tb = b.createdAt?.toMillis?.() || (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
      return tb - ta;
    });
    return list;
  } catch (err) {
    console.error('fetchSurveys error:', err);
    return [];
  }
}
async function fetchSurvey(id) {
  const doc = await db.collection('surveys').doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}
async function saveSurvey(survey) {
  const { id, ...data } = survey;
  if (!state.user) throw new Error('You must be signed in to save a survey.');

  data.authorId = state.user.uid;
  data.authorEmail = state.user.email || '';

  if (id) {
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('surveys').doc(id).set(data, { merge: true });
    return { id, ...data };
  } else {
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    const ref = await db.collection('surveys').add(data);
    return { id: ref.id, ...data };
  }
}
async function fetchResponses(surveyId) {
  const snap = await db.collection('surveys').doc(surveyId).collection('responses').orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function deleteSurveyDoc(id) {
  await db.collection('surveys').doc(id).delete();
}
async function submitSurveyResponse(surveyId, answers) {
  await db.collection('surveys').doc(surveyId).collection('responses').add({
    answers,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/* ══════════════════════════════════════════════════════════════
   VIEWS
   ══════════════════════════════════════════════════════════════ */

function loadingView() {
  return '<main class="page form-shell" style="text-align:center;padding-top:20vh"><p class="eyebrow">Survey Sathi</p><p class="sub">Loading…</p></main>';
}

/* ── LANDING ── */
function landing() {
  return `
  <main class="landing-page">
    <div class="landing-hero">
      <p class="eyebrow">Survey Sathi</p>
      <h1>Survey Sathi</h1>
    </div>
    <div class="landing-cards">
      <section class="card landing-card">
        <div class="landing-card-icon">${icons.clipboard}</div>
        <h2>Are you a participant?</h2>
        <form id="participant-form" novalidate>
          <label class="field-label" for="survey-id-input">Survey ID or link <span class="required">*</span></label>
          <input class="input" id="survey-id-input" name="surveyId" type="text" placeholder="e.g. team-pulse" required autocomplete="off" spellcheck="false">
          ${state.landingError ? `<p class="error" role="alert">${esc(state.landingError)}</p>` : ''}
          <button class="btn primary" type="submit">${icons.arrow} Take Survey</button>
        </form>
      </section>
      <section class="card landing-card">
        <div class="landing-card-icon">${icons.lock}</div>
        <h2>Are you an admin?</h2>
        <p class="sub">Sign in to create surveys and analyze responses.</p>
        <div class="landing-admin-body">
          <button class="btn amber" data-go="admin-login">${icons.lock} Sign in to create survey form</button>
        </div>
      </section>
    </div>
  </main>`;
}

/* ── LOGIN ── */
function loginView() {
  return `<main class="page form-shell">
    <section class="card form-card" style="margin-top:8vh">
      <button class="btn ghost" data-go="home" style="margin-bottom:22px">← Back</button>
      <p class="eyebrow">Survey Sathi / Admin</p>
      <h1>Sign in</h1>
      <form id="login-form" novalidate style="margin-top:28px">
        <label class="field-label" for="login-email">Email <span class="required">*</span></label>
        <input class="input" id="login-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
        <div id="email-error" class="field-error" role="alert"></div>

        <label class="field-label" style="margin-top:15px" for="login-password">Password <span class="required">*</span></label>
        <input class="input" id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Your password" required minlength="6">
        <div id="password-error" class="field-error" role="alert"></div>

        <div id="login-general-error" class="field-error" role="alert"></div>
        <button class="btn primary" type="submit" style="margin-top:14px">Sign in</button>
      </form>
      <p class="help" style="margin-top:18px;text-align:center">No account? <a href="/admin/register" class="link" data-go="register">Create one</a></p>
    </section>
  </main>`;
}

/* ── REGISTER ── */
function registerView() {
  return `<main class="page form-shell">
    <section class="card form-card" style="margin-top:8vh">
      <button class="btn ghost" data-go="admin-login" style="margin-bottom:22px">← Back to sign in</button>
      <p class="eyebrow">Survey Sathi / New account</p>
      <h1>Create account</h1>
      <form id="register-form" novalidate style="margin-top:28px">
        <label class="field-label" for="reg-email">Email <span class="required">*</span></label>
        <input class="input" id="reg-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
        <div id="reg-email-error" class="field-error" role="alert"></div>

        <label class="field-label" style="margin-top:15px" for="reg-password">Password <span class="required">*</span></label>
        <input class="input" id="reg-password" name="password" type="password" autocomplete="new-password" placeholder="At least 6 characters" required minlength="6">
        <div id="reg-password-error" class="field-error" role="alert"></div>

        <label class="field-label" style="margin-top:15px" for="reg-confirm">Confirm password <span class="required">*</span></label>
        <input class="input" id="reg-confirm" name="confirm" type="password" autocomplete="new-password" placeholder="Repeat password" required minlength="6">
        <div id="reg-confirm-error" class="field-error" role="alert"></div>

        <div id="reg-general-error" class="field-error" role="alert"></div>
        <button class="btn primary" type="submit" style="margin-top:14px">Create account</button>
      </form>
    </section>
  </main>`;
}

/* ── ADMIN SHELL ── */
function shell(content) {
  const email = state.user?.email || 'Admin';
  const initials = email.substring(0, 2).toUpperCase();
  return `<div class="shell"><aside class="sidebar"><div class="brand">[ SURVEY_SATHI ]</div><nav class="nav"><button data-nav="dashboard" class="${state.view === 'dashboard' ? 'active' : ''}">Overview</button><button data-nav="builder" class="${state.view === 'builder' ? 'active' : ''}">Builder</button><button data-nav="analytics" class="${state.view === 'analytics' ? 'active' : ''}">Analytics</button></nav><div class="sidebar-foot"><span class="avatar">${esc(initials)}</span><span>${esc(email.split('@')[0])}</span><button class="btn ghost" data-go="logout" style="margin-left:12px;min-height:32px;padding:5px 10px;font-size:10px">Log out</button></div></aside><main class="main"><header class="topbar"><div class="top-actions"><button class="btn amber" data-action="new">${icons.plus} New survey</button></div></header>${content}</main></div>`;
}

/* ── DASHBOARD ── */
function dashboard() {
  if (!state.surveys.length) {
    return shell(`<section class="page"><div class="page-heading"><div><p class="eyebrow">Dashboard</p><h1>No surveys yet</h1><p class="sub">Create your first survey to get started.</p></div><button class="btn primary" data-action="new">${icons.plus} New survey</button></div></section>`);
  }
  const s = state.survey || state.surveys[0];
  const shareLink = `${location.origin}/survey/${s.id}`;
  return shell(`<section class="page"><div class="page-heading"><div><p class="eyebrow">Dashboard</p><h1>${esc(s.title)}</h1><p class="sub">${s.status === 'published' ? 'Published' : 'Draft'} · ${s.questions?.length || 0} questions</p></div><div class="heading-actions"><button class="btn danger" data-action="delete-current-survey" data-survey-id="${s.id}">${icons.trash} Delete survey</button><button class="btn primary" data-action="edit-current-survey" data-survey-id="${s.id}">Edit survey</button></div></div>
  <div class="dashboard-grid">
    <section class="card"><div class="card-head"><h2>Share this survey</h2></div><div class="card-body"><div class="share-block"><label class="field-label">Survey ID</label><code class="share-id">${esc(s.id)}</code><label class="field-label" style="margin-top:12px">Direct link</label><div class="share-link-row"><input class="input share-link-input" value="${esc(shareLink)}" readonly id="share-link-input"><button class="btn ghost" id="copy-link-btn" style="min-height:38px;padding:6px 12px">Copy</button></div></div></div></section>
    <section class="card"><div class="card-head"><h2>All surveys</h2></div><div class="card-body">${state.surveys.map(x => `<div class="survey-row ${x.id === s.id ? 'active' : ''}"><div class="survey-info" data-select-survey="${x.id}" style="cursor:pointer"><b>${esc(x.title)}</b><span>${x.status === 'published' ? 'Live' : 'Draft'} · ${x.questions?.length || 0} questions</span></div><div class="survey-actions"><button class="icon-btn" data-edit-survey="${x.id}" title="Edit survey">${icons.edit}</button><button class="icon-btn delete" data-action="delete-survey-row" data-survey-id="${x.id}" title="Delete survey">${icons.trash}</button></div></div>`).join('')}</div></section>
  </div></section>`);
}

/* ── SANITIZE CONDITIONAL LOGIC ── */
function canDependOn(qId, candidateId, questions) {
  if (qId === candidateId) return false;
  let curr = questions.find(x => x.id === candidateId);
  const seen = new Set([candidateId]);
  while (curr && curr.condition && curr.condition.questionId) {
    if (curr.condition.questionId === qId) return false;
    if (seen.has(curr.condition.questionId)) break;
    seen.add(curr.condition.questionId);
    curr = questions.find(x => x.id === curr.condition.questionId);
  }
  return true;
}

function sanitizeConditions(questions) {
  if (!Array.isArray(questions)) return;
  questions.forEach(q => {
    if (q.condition && q.condition.questionId) {
      const target = questions.find(x => x.id === q.condition.questionId);
      if (!target || !canDependOn(q.id, target.id, questions)) {
        delete q.condition;
        return;
      }
      const validOps = target.type === 'single' ? ['equals', 'not_equals']
        : target.type === 'checkbox' ? ['contains', 'not_contains']
        : target.type === 'rating' ? ['equals', 'gte', 'lte']
        : ['filled', 'empty', 'equals'];
      
      if (!q.condition.op || !validOps.includes(q.condition.op)) {
        q.condition.op = validOps[0];
      }

      if (['single', 'checkbox'].includes(target.type)) {
        if (!target.options || !target.options.length) {
          delete q.condition;
        } else if (!target.options.includes(q.condition.equals)) {
          q.condition.equals = target.options[0];
        }
      } else if (target.type === 'rating') {
        const n = Number(q.condition.equals);
        if (isNaN(n) || n < 1 || n > 5) q.condition.equals = 5;
      } else if (target.type === 'text') {
        if (q.condition.op === 'filled' || q.condition.op === 'empty') {
          delete q.condition.equals;
        } else if (q.condition.equals === undefined) {
          q.condition.equals = '';
        }
      }
    }
  });
}

/* ── BUILDER ── */
function builder() {
  const s = state.survey;
  if (!s) {
    return shell(`
    <section class="page builder-page">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Survey builder</p>
          <h1>Survey builder</h1>
          <p class="sub">Create a new survey or choose an existing one below to edit.</p>
        </div>
        <button class="btn amber" data-action="new">${icons.plus} Create new survey</button>
      </div>

      <section class="card" style="margin-top:24px">
        <div class="card-head">
          <h2>Registered surveys (${state.surveys.length})</h2>
          <button class="btn amber" data-action="new" style="min-height:34px;padding:6px 12px">${icons.plus} New survey</button>
        </div>
        <div class="card-body">
          ${!state.surveys.length ? '<div class="empty">No surveys created yet. Click "Create new survey" above to begin.</div>' : ''}
          ${state.surveys.map(x => `
            <div class="survey-row">
              <div class="survey-info">
                <b>${esc(x.title)}</b>
                <span>${x.status === 'published' ? 'Live' : 'Draft'} · ${x.questions?.length || 0} questions · ID: <code>${esc(x.id)}</code></span>
              </div>
              <div class="survey-actions">
                <button class="btn ghost" data-edit-survey="${x.id}" style="min-height:34px;padding:6px 12px">${icons.edit} Edit</button>
                <button class="icon-btn delete" data-action="delete-survey-row" data-survey-id="${x.id}" title="Delete survey">${icons.trash}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    </section>`);
  }
  sanitizeConditions(s.questions);
  return shell(`<section class="page builder-page"><div class="page-heading"><div><button class="btn ghost" data-action="close-editor" style="margin-bottom:12px">← Back to all surveys</button><p class="eyebrow">Survey builder / Editing</p><h1>${esc(s.title || 'Untitled survey')}</h1></div><div class="heading-actions"><span class="draft-state">${s.questions?.length || 0} questions · ${s.status}</span><button class="btn danger" data-action="delete-current-survey" data-survey-id="${s.id}">${icons.trash} Delete</button><button class="btn ghost" data-action="publish" ${s.status === 'published' ? 'disabled' : ''}>${s.status === 'published' ? 'Published' : 'Publish'}</button><button class="btn primary" data-action="save">Save</button></div></div><div class="builder"><div class="builder-canvas"><section class="intro-card"><div><p class="eyebrow">Details</p><input data-survey="title" value="${esc(s.title)}" placeholder="Survey title"></div><textarea data-survey="description" placeholder="Description">${esc(s.description || '')}</textarea></section><div class="question-list"><div class="list-label">Questions</div>${(s.questions || []).map(questionEditor).join('')}</div><div class="builder-actions"><button class="btn primary" data-action="save">Save changes</button></div></div><aside class="card side-panel"><div class="card-head"><h2>Add question</h2></div><div class="card-body">${Object.entries(questionTypes).map(([k, v]) => `<button class="add-type" data-add="${k}"><span class="type-icon">${k === 'text' ? 'Aa' : k === 'rating' ? '1–5' : k === 'single' ? '◉' : '☷'}</span><span>${v}</span><b>+</b></button>`).join('')}</div></aside></div></section>`);
}

function questionEditor(q, i) {
  const allQs = state.survey?.questions || [];
  const choice = ['single', 'checkbox'].includes(q.type);
  const choiceContent = choice ? `<section class="editor-block option-block"><div class="block-head"><span>Options</span><button class="add-option" data-action="add-option">${icons.plus} Add</button></div><div class="options">${q.options.map((o, oi) => `<div class="option-edit"><span class="option-dot ${q.type === 'checkbox' ? 'square' : ''}"></span><input class="input" data-option="${oi}" value="${esc(o)}"><button class="icon-btn" data-action="remove-option" data-index="${oi}">${icons.trash}</button></div>`).join('')}</div></section>` : '';
  
  // Any other question in the survey that doesn't cause a circular dependency
  const availableTargets = allQs.filter(x => canDependOn(q.id, x.id, allQs));
  const hasCondition = Boolean(q.condition && q.condition.questionId);
  const conditionTarget = hasCondition ? allQs.find(x => x.id === q.condition.questionId) : null;

  let logicPanelHtml = '';
  if (hasCondition && conditionTarget) {
    const targetType = conditionTarget.type;
    const currentOp = q.condition.op || (targetType === 'checkbox' ? 'contains' : 'equals');
    let opOptionsHtml = '';
    let valueControlHtml = '';

    if (targetType === 'single') {
      opOptionsHtml = `
        <option value="equals" ${currentOp === 'equals' ? 'selected' : ''}>is equal to</option>
        <option value="not_equals" ${currentOp === 'not_equals' ? 'selected' : ''}>is not equal to</option>
      `;
      const opts = conditionTarget.options || [];
      valueControlHtml = `
        <div>
          <label class="field-label" style="font-size:10px;margin-bottom:4px">Option</label>
          <select class="select" data-condition-field="equals" data-question="${q.id}">
            ${opts.map(opt => `<option value="${esc(opt)}" ${q.condition.equals === opt ? 'selected' : ''}>${esc(opt)}</option>`).join('')}
          </select>
        </div>
      `;
    } else if (targetType === 'checkbox') {
      opOptionsHtml = `
        <option value="contains" ${currentOp === 'contains' ? 'selected' : ''}>includes</option>
        <option value="not_contains" ${currentOp === 'not_contains' ? 'selected' : ''}>does not include</option>
      `;
      const opts = conditionTarget.options || [];
      valueControlHtml = `
        <div>
          <label class="field-label" style="font-size:10px;margin-bottom:4px">Option</label>
          <select class="select" data-condition-field="equals" data-question="${q.id}">
            ${opts.map(opt => `<option value="${esc(opt)}" ${q.condition.equals === opt ? 'selected' : ''}>${esc(opt)}</option>`).join('')}
          </select>
        </div>
      `;
    } else if (targetType === 'rating') {
      opOptionsHtml = `
        <option value="equals" ${currentOp === 'equals' ? 'selected' : ''}>is equal to (★)</option>
        <option value="gte" ${currentOp === 'gte' ? 'selected' : ''}>is at least (≥ ★)</option>
        <option value="lte" ${currentOp === 'lte' ? 'selected' : ''}>is at most (≤ ★)</option>
      `;
      valueControlHtml = `
        <div>
          <label class="field-label" style="font-size:10px;margin-bottom:4px">Rating</label>
          <select class="select" data-condition-field="equals" data-question="${q.id}">
            ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${Number(q.condition.equals) === n ? 'selected' : ''}>${n} Star${n > 1 ? 's' : ''}</option>`).join('')}
          </select>
        </div>
      `;
    } else if (targetType === 'text') {
      opOptionsHtml = `
        <option value="filled" ${currentOp === 'filled' ? 'selected' : ''}>is answered (not empty)</option>
        <option value="empty" ${currentOp === 'empty' ? 'selected' : ''}>is unanswered (empty)</option>
        <option value="equals" ${currentOp === 'equals' ? 'selected' : ''}>equals text</option>
      `;
      if (currentOp === 'equals') {
        valueControlHtml = `
          <div>
            <label class="field-label" style="font-size:10px;margin-bottom:4px">Matching Text</label>
            <input class="input" data-condition-field="equals-text" data-question="${q.id}" value="${esc(q.condition.equals || '')}" placeholder="Exact text">
          </div>
        `;
      } else {
        valueControlHtml = `
          <div>
            <label class="field-label" style="font-size:10px;margin-bottom:4px">Value</label>
            <div style="font:600 11px var(--mono);color:var(--muted);padding:9px 10px;border:1px dashed var(--line);background:white;white-space:nowrap">[Any text input]</div>
          </div>
        `;
      }
    }

    logicPanelHtml = `
      <div class="logic-panel">
        <div class="logic-panel-header">
          <small>↳ Show this question only when:</small>
          <button class="icon-btn delete" data-action="remove-logic" data-question="${q.id}" title="Remove rule">${icons.trash}</button>
        </div>
        <div class="logic-fields">
          <div>
            <label class="field-label" style="font-size:10px;margin-bottom:4px">If Question</label>
            <select class="select" data-condition-field="questionId" data-question="${q.id}">
              ${availableTargets.map(c => {
                const cIdx = allQs.findIndex(x => x.id === c.id);
                return `<option value="${c.id}" ${q.condition.questionId === c.id ? 'selected' : ''}>Q${cIdx + 1}: ${esc(c.label || 'Untitled question')} (${c.type})</option>`;
              }).join('')}
            </select>
          </div>
          <div>
            <label class="field-label" style="font-size:10px;margin-bottom:4px">Condition</label>
            <select class="select" data-condition-field="op" data-question="${q.id}">
              ${opOptionsHtml}
            </select>
          </div>
          ${valueControlHtml}
        </div>
      </div>`;
  }

  return `<article class="card question-card" data-question="${q.id}">
    <header class="question-toolbar">
      <div class="question-ident">
        <span class="q-number">Q${String(i + 1).padStart(2, '0')}</span>
        <select class="select" data-field="type">
          ${Object.entries(questionTypes).map(([k, v]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="question-actions">
        <button class="icon-btn" data-action="up" ${i === 0 ? 'disabled style="opacity:0.35;cursor:not-allowed"' : ''}>${icons.up}</button>
        <button class="icon-btn" data-action="down" ${i === allQs.length - 1 ? 'disabled style="opacity:0.35;cursor:not-allowed"' : ''}>${icons.down}</button>
        <button class="icon-btn delete" data-action="delete">${icons.trash}</button>
      </div>
    </header>
    <div class="question-body">
      <section class="editor-block">
        <label class="field-label">Question</label>
        <input class="input question-input" data-field="label" value="${esc(q.label)}" placeholder="Your question">
      </section>
      ${choiceContent}
    </div>
    <footer class="question-footer">
      <label class="switch-line"><input type="checkbox" data-field="required" ${q.required ? 'checked' : ''}> Required</label>
      <button type="button" class="logic ${hasCondition && conditionTarget ? 'active' : ''}" data-action="toggle-logic" data-question="${q.id}">${hasCondition && conditionTarget ? '✓ Logic active' : '+ Add conditional logic'}</button>
    </footer>
    ${logicPanelHtml}
  </article>`;
}

/* ── ANALYTICS ── */
async function analyticsView() {
  if (!state.surveys.length) {
    return shell(`<section class="page"><div class="page-heading"><div><p class="eyebrow">Analytics</p><h1>No surveys yet</h1><p class="sub">Create a survey first to see its analytics.</p></div></div></section>`);
  }
  const s = state.survey || state.surveys[0];
  const responses = await fetchResponses(s.id);
  const total = responses.length;
  return shell(`<section class="page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">Analytics</p>
        <h1>${esc(s.title)}</h1>
        <p class="sub">${total} response${total === 1 ? '' : 's'} recorded</p>
      </div>
      <div class="heading-actions" style="align-items:center;gap:12px">
        <select class="select" id="analytics-survey-select" style="min-width:220px">
          ${state.surveys.map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}
        </select>
        <a href="/survey/${encodeURIComponent(s.id)}" target="_blank" class="btn ghost" style="text-decoration:none">${icons.eye} Open Form</a>
      </div>
    </div>

    <div class="metrics">
      <article class="metric">
        <div class="metric-label">Total responses</div>
        <div class="metric-number">${total}</div>
        <div class="metric-note">Live in Firestore</div>
      </article>
      <article class="metric">
        <div class="metric-label">Survey questions</div>
        <div class="metric-number">${(s.questions || []).length}</div>
        <div class="metric-note">${s.status === 'published' ? 'Published' : 'Draft'}</div>
      </article>
      <article class="metric">
        <div class="metric-label">Survey ID</div>
        <div class="metric-number" style="font-size:16px;margin-top:35px;font-family:var(--mono);word-break:break-all">${esc(s.id)}</div>
        <div class="metric-note">Unique share key</div>
      </article>
    </div>

    ${total === 0 ? `<div class="card" style="padding:40px;text-align:center;margin-bottom:20px"><p class="sub" style="margin:0">No responses collected yet for this survey. Share your survey link or ID with participants to begin collecting data.</p></div>` : ''}
    <div class="analytics-grid">${(s.questions || []).map(q => insightBlock(q, responses)).join('')}</div>
  </section>`);
}

function insightBlock(q, responses) {
  const vals = responses.map(r => r.answers?.[q.id]).filter(v => v !== undefined && v !== '');
  if (q.type === 'rating') {
    const nums = vals.map(Number).filter(n => !isNaN(n));
    const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '—';
    const dist = [1, 2, 3, 4, 5].map(v => ({ v, count: nums.filter(x => x === v).length }));
    return `<article class="card insight">
      <h3>${esc(q.label)}</h3>
      <p class="meta">RATING · ${nums.length} answers</p>
      <div style="display:flex;align-items:baseline;gap:8px;margin:8px 0 14px">
        <strong class="avg">${avg}</strong>
        <span style="font:600 14px var(--mono);color:var(--muted)">/ 5.0</span>
      </div>
      <div class="rating-bars">
        ${dist.map(d => `<div class="count-row"><span>${d.v} ★</span><div class="track"><b style="width:${nums.length ? d.count / nums.length * 100 : 0}%"></b></div><em>${d.count}</em></div>`).join('')}
      </div>
    </article>`;
  }
  if (q.type === 'single' || q.type === 'checkbox') {
    const counts = {};
    (q.options || []).forEach(o => counts[o] = 0);
    vals.forEach(v => (Array.isArray(v) ? v : [v]).forEach(x => { if (x in counts) counts[x]++; }));
    return `<article class="card insight">
      <h3>${esc(q.label)}</h3>
      <p class="meta">${q.type === 'single' ? 'SINGLE SELECT' : 'MULTI-SELECT'} · ${vals.length} answers</p>
      ${Object.entries(counts).map(([o, n]) => `<div class="count-row"><span>${esc(o)}</span><div class="track"><b style="width:${vals.length ? n / vals.length * 100 : 0}%"></b></div><em>${n}</em></div>`).join('')}
    </article>`;
  }
  return `<article class="card insight full">
    <h3>${esc(q.label)}</h3>
    <p class="meta">TEXT RESPONSES · ${vals.length} answers</p>
    ${vals.length ? vals.map(v => `<div class="quote">"${esc(v)}"</div>`).join('') : '<div class="empty">No written responses yet.</div>'}
  </article>`;
}

/* ── CONDITIONAL LOGIC CHECK ── */
function conditionVisible(q, answers = state.answers, visited = new Set()) {
  if (!q.condition || !q.condition.questionId) return true;
  if (visited.has(q.id)) return false;
  visited.add(q.id);

  const targetQ = (state.survey?.questions || []).find(x => x.id === q.condition.questionId);
  if (!targetQ) return true;

  // If the target question itself is conditionally hidden, this question is hidden too
  if (!conditionVisible(targetQ, answers, visited)) return false;

  const val = answers[q.condition.questionId];
  const op = q.condition.op || (targetQ.type === 'checkbox' ? 'contains' : 'equals');
  const expected = q.condition.equals;

  if (op === 'filled') {
    if (val === undefined || val === null || val === '') return false;
    if (Array.isArray(val) && !val.length) return false;
    return true;
  }
  if (op === 'empty') {
    if (val === undefined || val === null || val === '') return true;
    if (Array.isArray(val) && !val.length) return true;
    return false;
  }

  // If value is empty or unanswered, other conditions fail
  if (val === undefined || val === null || val === '') return false;

  if (targetQ.type === 'rating') {
    const numVal = Number(val);
    const numExpected = Number(expected);
    if (isNaN(numVal) || isNaN(numExpected)) return false;
    if (op === 'equals') return numVal === numExpected;
    if (op === 'gte') return numVal >= numExpected;
    if (op === 'lte') return numVal <= numExpected;
    return numVal === numExpected;
  }

  if (targetQ.type === 'checkbox') {
    const arr = Array.isArray(val) ? val : [val];
    if (op === 'contains') return arr.includes(expected);
    if (op === 'not_contains') return !arr.includes(expected);
    return arr.includes(expected);
  }

  // Single select and text
  if (op === 'equals') {
    return String(val).trim().toLowerCase() === String(expected).trim().toLowerCase();
  }
  if (op === 'not_equals') {
    return String(val).trim().toLowerCase() !== String(expected).trim().toLowerCase();
  }

  return String(val) === String(expected);
}

/* ── PUBLIC FORM ── */
function publicForm() {
  const s = state.survey;
  if (state.submitted) return `<main class="page form-shell"><section class="card success"><div class="success-mark">✓</div><p class="eyebrow">Response received</p><h1>Thank you!</h1><p class="sub" style="margin:14px auto">Your response has been recorded.</p><button class="btn primary" data-go="home" style="margin-top:25px">← Home</button></section></main>`;
  const allQuestions = s.questions || [];
  const visibleQuestions = allQuestions.filter(q => conditionVisible(q));
  const answered = visibleQuestions.filter(q => state.answers[q.id] !== undefined && state.answers[q.id] !== '' && (!Array.isArray(state.answers[q.id]) || state.answers[q.id].length)).length;
  return `<main class="page form-shell"><section class="form-hero"><p class="eyebrow">Survey Sathi</p><h1>${esc(s.title)}</h1>${s.description ? `<p class="sub" style="color:#c5e2de">${esc(s.description)}</p>` : ''}<p class="survey-id-badge">Survey ID: <code>${esc(s.id)}</code></p></section><form class="card form-card" id="response-form" novalidate>${Object.keys(state.errors).length ? `<div class="error-summary" role="alert" tabindex="-1"><b>Please fix the errors below</b><br>${esc(Object.values(state.errors)[0])}</div>` : ''}<div class="progress"><b style="width:${visibleQuestions.length ? answered / visibleQuestions.length * 100 : 0}%"></b></div>${visibleQuestions.map((q, i) => formQuestion(q, i, visibleQuestions.length)).join('')}<button class="btn amber" type="submit" style="margin-top:27px">Submit response</button></form></main>`;
}

function formQuestion(q, i, total) {
  const val = state.answers[q.id], error = state.errors[q.id];
  let control = '';
  if (q.type === 'text') control = `<textarea class="input answer-input" data-answer="${q.id}" rows="3" placeholder="Your answer…">${esc(val || '')}</textarea>`;
  if (['single', 'checkbox'].includes(q.type)) control = `<div class="choices">${(q.options || []).map(o => `<label class="choice"><input type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="${q.id}" value="${esc(o)}" data-answer="${q.id}" ${(q.type === 'single' ? val === o : Array.isArray(val) && val.includes(o)) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
  if (q.type === 'rating') control = `<div class="rating" role="radiogroup">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-rate="${q.id}" data-value="${n}" class="${Number(val) === n ? 'active' : ''}">${n}</button>`).join('')}</div>`;
  const countDisplay = total ? `${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : `Q${i + 1}`;
  return `<section class="form-question"><p class="kicker" style="color:var(--muted);margin:0 0 9px">${countDisplay}</p><h2>${esc(q.label)} ${q.required ? '<span class="required">*</span>' : ''}</h2>${control}${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}</section>`;
}


/* ══════════════════════════════════════════════════════════════
   RENDER
   ══════════════════════════════════════════════════════════════ */
async function render(adminView) {
  const route = getRoute();

  if (state.loading) { $('#app').innerHTML = loadingView(); return; }

  // Landing
  if (route.page === 'landing') {
    state.view = 'landing';
    $('#app').innerHTML = landing();
    bind(); return;
  }

  // Login
  if (route.page === 'login') {
    if (state.user) { navigate('/admin'); return; }
    state.view = 'login';
    $('#app').innerHTML = loginView();
    bind(); return;
  }

  // Register
  if (route.page === 'register') {
    if (state.user) { navigate('/admin'); return; }
    state.view = 'register';
    $('#app').innerHTML = registerView();
    bind(); return;
  }

  // Public survey
  if (route.page === 'public') {
    state.view = 'public';
    try {
      if (!state.survey || state.survey.id !== route.surveyId) {
        state.answers = {}; state.errors = {}; state.submitted = false;
        const s = await fetchSurvey(route.surveyId);
        if (!s) {
          $('#app').innerHTML = `<main class="page form-shell"><section class="card form-card" style="margin-top:8vh;text-align:center"><h1 style="font-size:28px">Survey not found</h1><p class="sub" style="margin:12px auto">ID <code>${esc(route.surveyId)}</code> doesn't exist or isn't published.</p><button class="btn primary" data-go="home" style="margin-top:20px">← Home</button></section></main>`;
          bind(); return;
        }
        state.survey = s;
      }
      $('#app').innerHTML = publicForm();
      bind();
    } catch (e) {
      $('#app').innerHTML = `<main class="page"><div class="card empty">${esc(e.message)}</div></main>`;
    }
    return;
  }

  // Admin
  if (route.page === 'admin') {
    if (!state.user) { navigate('/admin/login'); return; }
    state.view = adminView || 'dashboard';
    try {
      state.surveys = await fetchSurveys();
      if (!state.surveys.find(x => x.id === state.survey?.id)) {
        state.survey = (state.surveys.length && (state.view === 'dashboard' || state.view === 'analytics')) ? state.surveys[0] : null;
      }
      if (state.view === 'analytics') {
        $('#app').innerHTML = await analyticsView();
      } else {
        const screens = { dashboard, builder };
        $('#app').innerHTML = screens[state.view]();
      }
      bind();
    } catch (e) {
      $('#app').innerHTML = `<main class="page"><div class="card empty">${esc(e.message)}</div></main>`;
    }
  }
}


/* ══════════════════════════════════════════════════════════════
   BIND
   ══════════════════════════════════════════════════════════════ */
function bind() {
  /* Navigation */
  $$('[data-go]').forEach(b => b.onclick = e => {
    e.preventDefault();
    const t = b.dataset.go;
    if (t === 'home') { state.landingError = null; state.survey = null; navigate('/'); }
    if (t === 'admin-login') navigate('/admin/login');
    if (t === 'register') navigate('/admin/register');
    if (t === 'logout') { auth.signOut(); state.user = null; state.survey = null; state.surveys = []; navigate('/'); }
  });

  $$('[data-nav]').forEach(b => b.onclick = () => {
    if (b.dataset.nav === 'builder') state.survey = null;
    render(b.dataset.nav);
  });

  /* Survey selection on dashboard */
  $$('[data-select-survey]').forEach(el => el.onclick = () => {
    const s = state.surveys.find(x => x.id === el.dataset.selectSurvey);
    if (s) { state.survey = s; render('dashboard'); }
  });
  $$('[data-select-survey]').forEach(el => { el.style.cursor = 'pointer'; });

  $$('[data-edit-survey]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const s = state.surveys.find(x => x.id === b.dataset.editSurvey);
    if (s) { state.survey = JSON.parse(JSON.stringify(s)); render('builder'); }
  });

  /* Analytics survey select */
  const analyticsSelect = $('#analytics-survey-select');
  if (analyticsSelect) {
    analyticsSelect.onchange = async () => {
      const selected = state.surveys.find(x => x.id === analyticsSelect.value);
      if (selected) {
        state.survey = selected;
        $('#app').innerHTML = await analyticsView();
        bind();
      }
    };
  }

  /* Participant form */
  const pForm = $('#participant-form');
  if (pForm) {
    pForm.onsubmit = e => {
      e.preventDefault();
      const input = pForm.querySelector('[name="surveyId"]');
      let raw = input.value.trim();
      state.landingError = null;
      if (!raw) { state.landingError = 'Please enter a survey ID or link.'; input.classList.add('input-error'); renderLandingError(pForm); input.focus(); return; }
      const urlMatch = raw.match(/\/survey\/([a-zA-Z0-9_-]+)\/?$/);
      const surveyId = urlMatch ? urlMatch[1] : raw;
      if (!/^[a-zA-Z0-9_-]+$/.test(surveyId)) { state.landingError = 'Invalid survey ID format.'; input.classList.add('input-error'); renderLandingError(pForm); input.focus(); return; }
      navigate(`/survey/${surveyId}`);
    };
    const idInput = pForm.querySelector('[name="surveyId"]');
    if (idInput) idInput.addEventListener('input', () => { idInput.classList.remove('input-error'); const err = pForm.querySelector('.error'); if (err) err.remove(); });
  }

  /* Login form — Firebase Auth */
  const loginForm = $('#login-form');
  if (loginForm) {
    loginForm.onsubmit = async e => {
      e.preventDefault();
      let valid = true;
      const emailInput = $('#login-email'), passwordInput = $('#login-password');
      const emailErr = $('#email-error'), passwordErr = $('#password-error'), genErr = $('#login-general-error');
      emailErr.textContent = ''; passwordErr.textContent = ''; genErr.textContent = '';
      emailInput.classList.remove('input-error'); passwordInput.classList.remove('input-error');

      const email = emailInput.value.trim(), password = passwordInput.value;
      if (!email) { emailErr.textContent = 'Email is required.'; emailInput.classList.add('input-error'); valid = false; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { emailErr.textContent = 'Enter a valid email.'; emailInput.classList.add('input-error'); valid = false; }
      if (!password) { passwordErr.textContent = 'Password is required.'; passwordInput.classList.add('input-error'); valid = false; }
      else if (password.length < 6) { passwordErr.textContent = 'Min 6 characters.'; passwordInput.classList.add('input-error'); valid = false; }
      if (!valid) return;

      try {
        state.survey = null;
        state.surveys = [];
        await auth.signInWithEmailAndPassword(email, password);
        // onAuthStateChanged will handle navigation
      } catch (err) {
        const msg = err.code === 'auth/user-not-found' ? 'No account with this email.'
          : err.code === 'auth/wrong-password' ? 'Wrong password.'
          : err.code === 'auth/invalid-credential' ? 'Invalid email or password.'
          : err.code === 'auth/too-many-requests' ? 'Too many attempts. Try later.'
          : err.message;
        genErr.textContent = msg;
      }
    };
    ['login-email', 'login-password'].forEach(id => { const el = $(`#${id}`); if (el) el.addEventListener('input', () => { el.classList.remove('input-error'); }); });
  }

  /* Register form — Firebase Auth */
  const regForm = $('#register-form');
  if (regForm) {
    regForm.onsubmit = async e => {
      e.preventDefault();
      let valid = true;
      const emailInput = $('#reg-email'), passwordInput = $('#reg-password'), confirmInput = $('#reg-confirm');
      const emailErr = $('#reg-email-error'), passwordErr = $('#reg-password-error'), confirmErr = $('#reg-confirm-error'), genErr = $('#reg-general-error');
      [emailErr, passwordErr, confirmErr, genErr].forEach(el => el.textContent = '');
      [emailInput, passwordInput, confirmInput].forEach(el => el.classList.remove('input-error'));

      const email = emailInput.value.trim(), password = passwordInput.value, confirm = confirmInput.value;
      if (!email) { emailErr.textContent = 'Email is required.'; emailInput.classList.add('input-error'); valid = false; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { emailErr.textContent = 'Enter a valid email.'; emailInput.classList.add('input-error'); valid = false; }
      if (!password) { passwordErr.textContent = 'Password is required.'; passwordInput.classList.add('input-error'); valid = false; }
      else if (password.length < 6) { passwordErr.textContent = 'Min 6 characters.'; passwordInput.classList.add('input-error'); valid = false; }
      if (!confirm) { confirmErr.textContent = 'Confirm your password.'; confirmInput.classList.add('input-error'); valid = false; }
      else if (password !== confirm) { confirmErr.textContent = "Passwords don't match."; confirmInput.classList.add('input-error'); valid = false; }
      if (!valid) return;

      try {
        state.survey = null;
        state.surveys = [];
        await auth.createUserWithEmailAndPassword(email, password);
      } catch (err) {
        const msg = err.code === 'auth/email-already-in-use' ? 'Email already registered.'
          : err.code === 'auth/weak-password' ? 'Password too weak.'
          : err.message;
        genErr.textContent = msg;
      }
    };
    ['reg-email', 'reg-password', 'reg-confirm'].forEach(id => { const el = $(`#${id}`); if (el) el.addEventListener('input', () => { el.classList.remove('input-error'); }); });
  }

  /* Admin actions */
  $$('[data-action]').forEach(b => b.onclick = () => adminAction(b));
  $$('[data-add]').forEach(b => { b.onclick = () => { if (!state.survey) return; state.survey.questions = state.survey.questions || []; state.survey.questions.push(freshQuestion(b.dataset.add)); render('builder'); }; });

  /* Question editor */
  $$('[data-question]').forEach(card => {
    const q = state.survey?.questions?.find(x => x.id === card.dataset.question);
    if (!q) return;
    card.querySelectorAll('[data-field]').forEach(el => {
      const update = () => q[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
      if (el.tagName === 'SELECT') {
        el.onchange = () => {
          update();
          if (!['single', 'checkbox'].includes(q.type)) delete q.options;
          if (['single', 'checkbox'].includes(q.type) && !q.options) q.options = ['Option 1', 'Option 2'];
          sanitizeConditions(state.survey?.questions);
          render('builder');
        };
      }
      else if (el.type === 'checkbox') el.onchange = update;
      else el.oninput = update;
    });
    card.querySelectorAll('[data-option]').forEach(el => el.oninput = () => q.options[+el.dataset.option] = el.value);
  });
  $$('[data-survey]').forEach(el => el.oninput = () => { if (state.survey) state.survey[el.dataset.survey] = el.value; });

  /* Conditional logic controls */
  $$('[data-condition-field="questionId"]').forEach(sel => {
    sel.onchange = () => {
      const q = (state.survey?.questions || []).find(x => x.id === sel.dataset.question);
      if (!q) return;
      q.condition = q.condition || {};
      q.condition.questionId = sel.value;
      const targetQ = (state.survey?.questions || []).find(x => x.id === sel.value);
      if (targetQ) {
        if (targetQ.type === 'single') {
          q.condition.op = 'equals';
          q.condition.equals = targetQ.options?.[0] || '';
        } else if (targetQ.type === 'checkbox') {
          q.condition.op = 'contains';
          q.condition.equals = targetQ.options?.[0] || '';
        } else if (targetQ.type === 'rating') {
          q.condition.op = 'equals';
          q.condition.equals = 5;
        } else if (targetQ.type === 'text') {
          q.condition.op = 'filled';
          delete q.condition.equals;
        }
      }
      render('builder');
    };
  });
  $$('[data-condition-field="op"]').forEach(sel => {
    sel.onchange = () => {
      const q = (state.survey?.questions || []).find(x => x.id === sel.dataset.question);
      if (!q || !q.condition) return;
      q.condition.op = sel.value;
      const targetQ = (state.survey?.questions || []).find(x => x.id === q.condition.questionId);
      if (targetQ && targetQ.type === 'text') {
        if (sel.value === 'equals') {
          q.condition.equals = q.condition.equals || '';
        } else {
          delete q.condition.equals;
        }
      }
      render('builder');
    };
  });
  $$('[data-condition-field="equals"]').forEach(sel => {
    sel.onchange = () => {
      const q = (state.survey?.questions || []).find(x => x.id === sel.dataset.question);
      if (q && q.condition) q.condition.equals = sel.value;
    };
  });
  $$('[data-condition-field="equals-text"]').forEach(inp => {
    inp.oninput = () => {
      const q = (state.survey?.questions || []).find(x => x.id === inp.dataset.question);
      if (q && q.condition) q.condition.equals = inp.value;
    };
  });

  /* Public form */
  const form = $('#response-form');
  if (form) form.onsubmit = handleSubmitResponse;
  $$('[data-answer]').forEach(el => el.onchange = () => {
    const id = el.dataset.answer;
    if (el.type === 'checkbox') { const c = state.answers[id] || []; state.answers[id] = el.checked ? [...c, el.value] : c.filter(x => x !== el.value); }
    else state.answers[id] = el.value;
    delete state.errors[id]; renderPublic();
  });
  $$('[data-answer]').forEach(el => {
    if (el.tagName === 'TEXTAREA') {
      el.oninput = () => { state.answers[el.dataset.answer] = el.value; };
      el.onchange = () => { renderPublic(); };
    }
  });
  $$('[data-rate]').forEach(b => b.onclick = () => { state.answers[b.dataset.rate] = +b.dataset.value; delete state.errors[b.dataset.rate]; renderPublic(); });

  /* Copy link */
  const copyBtn = $('#copy-link-btn');
  if (copyBtn) copyBtn.onclick = () => { const input = $('#share-link-input'); if (input) navigator.clipboard.writeText(input.value).then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); }); };
}

function renderLandingError(form) {
  const existing = form.querySelector('.error');
  if (existing) existing.remove();
  if (state.landingError) {
    const btn = form.querySelector('button[type="submit"]');
    const p = document.createElement('p'); p.className = 'error'; p.setAttribute('role', 'alert'); p.textContent = state.landingError;
    btn.before(p);
  }
}

function renderPublic() {
  if (state.view === 'public') { $('#app').innerHTML = publicForm(); bind(); }
}

async function adminAction(b) {
  const act = b.dataset.action, card = b.closest('[data-question]');
  if (act === 'close-editor') {
    state.survey = null;
    render('builder');
    return;
  }
  if (act === 'delete-current-survey' || act === 'delete-survey-row') {
    const surveyId = b.dataset.surveyId || state.survey?.id;
    if (!surveyId) return;
    if (!confirm('Are you sure you want to delete this survey? This cannot be undone.')) return;
    try {
      await deleteSurveyDoc(surveyId);
      state.surveys = await fetchSurveys();
      state.survey = state.surveys[0] || null;
      toast('Survey deleted.');
      render('dashboard');
    } catch (e) {
      toast(e.message, true);
    }
    return;
  }
  if (act === 'edit-current-survey') {
    const s = state.surveys.find(x => x.id === b.dataset.surveyId);
    if (s) state.survey = JSON.parse(JSON.stringify(s));
    render('builder');
    return;
  }
  if (act === 'new') {
    const newSurvey = await saveSurvey({ title: 'Untitled survey', description: '', questions: [freshQuestion('text')], status: 'draft' });
    state.survey = newSurvey;
    state.surveys = await fetchSurveys();
    render('builder');
    return;
  }
  if (act === 'save') {
    try {
      await saveSurvey(state.survey);
      state.surveys = await fetchSurveys();
      state.survey = null;
      toast('Survey saved!');
      render('builder');
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (act === 'publish') {
    try {
      state.survey.status = 'published';
      await saveSurvey(state.survey);
      state.surveys = await fetchSurveys();
      state.survey = null;
      toast('Survey published!');
      render('builder');
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (act === 'toggle-logic') {
    const qid = b.dataset.question;
    const qs = state.survey?.questions || [];
    const q = qs.find(x => x.id === qid);
    if (!q) return;

    if (q.condition && q.condition.questionId) {
      delete q.condition;
      render('builder');
      return;
    }

    const availableTargets = qs.filter(x => canDependOn(q.id, x.id, qs));
    if (!availableTargets.length) {
      toast('Add at least one other question to set conditional logic.', true);
      return;
    }

    const target = availableTargets[0];
    const defaultOp = target.type === 'single' ? 'equals'
      : target.type === 'checkbox' ? 'contains'
      : target.type === 'rating' ? 'equals'
      : 'filled';

    const defaultVal = ['single', 'checkbox'].includes(target.type) ? (target.options?.[0] || '')
      : target.type === 'rating' ? 5
      : '';

    q.condition = {
      questionId: target.id,
      op: defaultOp,
      equals: defaultVal
    };

    render('builder');
    return;
  }
  if (act === 'remove-logic') {
    const qid = b.dataset.question;
    const q = (state.survey?.questions || []).find(x => x.id === qid);
    if (q) delete q.condition;
    render('builder');
    return;
  }
  if (card) {
    const qs = state.survey.questions || [];
    const i = qs.findIndex(q => q.id === card.dataset.question), q = qs[i];
    if (act === 'delete') {
      if (qs.length <= 1) { toast('Need at least one question.', true); return; }
      qs.splice(i, 1);
      sanitizeConditions(qs);
      render('builder');
    }
    if (act === 'up' && i > 0) {
      [qs[i - 1], qs[i]] = [q, qs[i - 1]];
      sanitizeConditions(qs);
      render('builder');
    }
    if (act === 'down' && i < qs.length - 1) {
      [qs[i + 1], qs[i]] = [q, qs[i + 1]];
      sanitizeConditions(qs);
      render('builder');
    }
    if (act === 'add-option') {
      q.options.push(`Option ${q.options.length + 1}`);
      render('builder');
    }
    if (act === 'remove-option' && q.options.length > 2) {
      q.options.splice(+b.dataset.index, 1);
      sanitizeConditions(qs);
      render('builder');
    }
  }
}

async function handleSubmitResponse(e) {
  e.preventDefault();
  state.errors = {};
  const visibleQuestions = (state.survey?.questions || []).filter(q => conditionVisible(q));
  for (const q of visibleQuestions) {
    const val = state.answers[q.id];
    if (q.required && (val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length))) {
      state.errors[q.id] = `${q.label || 'This question'} is required.`;
    }
  }
  if (Object.keys(state.errors).length) {
    renderPublic();
    setTimeout(() => $('.error-summary')?.focus(), 0);
    return;
  }

  // Only submit responses for visible questions
  const cleanAnswers = {};
  for (const q of visibleQuestions) {
    if (state.answers[q.id] !== undefined && state.answers[q.id] !== '') {
      cleanAnswers[q.id] = state.answers[q.id];
    }
  }

  try {
    await submitSurveyResponse(state.survey.id, cleanAnswers);
    state.submitted = true;
    renderPublic();
  } catch (err) {
    state.errors.general = err.message;
    renderPublic();
  }
}

function toast(message, error = false) {
  const t = document.createElement('div'); t.className = 'toast'; t.style.background = error ? '#8b2f24' : '';
  t.textContent = message; document.body.append(t); setTimeout(() => t.remove(), 2800);
}


/* ══════════════════════════════════════════════════════════════
   AUTH STATE LISTENER — single source of truth
   ══════════════════════════════════════════════════════════════ */
auth.onAuthStateChanged(user => {
  if (!user || (state.user && state.user.uid !== user.uid)) {
    state.survey = null;
    state.surveys = [];
  }
  state.user = user;
  state.loading = false;
  const route = getRoute();
  if (user && (route.page === 'login' || route.page === 'register')) {
    navigate('/admin');
  } else {
    render();
  }
});
