// המתכונים שלי - static site. Email accounts; each user sees only her own recipes.
// Backend: Cloudflare Worker (see worker.js). When opened from file:// (local
// preview only), a local mock store replaces the API so the design can be
// previewed without the server.
(function () {
    'use strict';

    var API = 'https://recipes.y0546367987.workers.dev';
    var LS_TOKEN = 'recipes-token.v1';

    var ICONS = {
        meal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15h16"/><path d="M5 15a7 7 0 0 1 14 0"/><path d="M12 8V6.5"/><circle cx="12" cy="5" r="1"/><path d="M3 19h18"/></svg>',
        dessert: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21h10"/><path d="M8 21l1.2-7h5.6L16 21"/><path d="M7.5 11a4.5 4.5 0 0 1 9 0"/><path d="M12 6.5V5"/><circle cx="12" cy="3.6" r="0.9"/></svg>',
        cookie: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 12.6A8.5 8.5 0 1 1 11.4 3.5a3.2 3.2 0 0 0 3.2 3.2 3.2 3.2 0 0 0 3.1 3.2 3.1 3.1 0 0 0 2.8 2.7Z"/><circle cx="9" cy="11" r="0.6"/><circle cx="13.5" cy="14.5" r="0.6"/><circle cx="9.5" cy="16" r="0.6"/></svg>',
        pastry: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 9.5C4 8 4 5.5 6 4.5c2.5-1.2 5 .5 6 2 1-1.5 3.5-3.2 6-2 2 1 2 3.5.5 5"/><path d="M5.5 9.5C4 11 4 13.5 6 14.5c2.5 1.2 5-.5 6-2 1 1.5 3.5 3.2 6 2 2-1 2-3.5.5-5"/><path d="M6 14.5c-1.8 1.6-2 4-.5 5.5 1.7 1.7 4 1.3 5.5-.5"/><path d="M18 14.5c1.8 1.6 2 4 .5 5.5-1.7 1.7-4 1.3-5.5-.5"/></svg>',
        flask: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 3h5"/><path d="M10.5 3v5.2L5.8 17a3 3 0 0 0 2.7 4.4h7a3 3 0 0 0 2.7-4.4L13.5 8.2V3"/><path d="M7.5 14.5h9"/></svg>',
        plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        link: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.7 1.7"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.7-1.7"/></svg>',
        note: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14v13l-4 4H5Z"/><path d="M15 21v-4h4"/></svg>',
        book: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 20.5V5.5"/><path d="M20 18v3H6.5"/></svg>',
        edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5l4 4L8 20H4v-4Z"/><path d="M12.5 7.5l4 4"/></svg>',
        trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7l1 13h9l1-13"/></svg>',
        logout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h-8v16h8"/><path d="M10 12h11"/><path d="M17.5 8.5 21 12l-3.5 3.5"/></svg>',
    };

    var CATS = [
        { id: 'ארוחה', icon: ICONS.meal },
        { id: 'קינוחים', icon: ICONS.dessert },
        { id: 'עוגיות', icon: ICONS.cookie },
        { id: 'מאפים', icon: ICONS.pastry },
        { id: 'לניסיון', icon: ICONS.flask },
    ];
    function catOf(id) { for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i]; return null; }

    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function getToken() { try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; } }
    function setToken(t) { try { if (t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN); } catch (e) {} }

    // ---------- API layer (real worker, or local mock for file:// preview) ----------
    var MOCK = location.protocol === 'file:';
    var MOCK_KEY = 'recipes-mock.v1';

    function mockStore() {
        var s;
        try { s = JSON.parse(localStorage.getItem(MOCK_KEY) || 'null'); } catch (e) { s = null; }
        if (!s) s = { users: {}, sessions: {} };
        return s;
    }
    function mockSave(s) { try { localStorage.setItem(MOCK_KEY, JSON.stringify(s)); } catch (e) {} }
    function mockUser(s, token) { return s.sessions[token] ? s.users[s.sessions[token]] : null; }

    var DEMO_RECIPES = [
        { id: 'd1', title: 'פסטה שמנת פטריות', category: 'ארוחה', link: 'https://www.mako.co.il/food-recipes', text: '', notes: 'פחות מלח ממה שכתוב, ולהוסיף שום' },
        { id: 'd2', title: 'עוגת שוקולד של שבת', category: 'קינוחים', link: '', text: '200 גרם שוקולד מריר\n150 גרם חמאה\n3 ביצים\nכוס סוכר\nכוס קמח\nאופים 25 דקות על 180', notes: 'יוצאת הכי טוב כשהיא קצת נוזלית באמצע' },
        { id: 'd3', title: 'עוגיות חמאה', category: 'עוגיות', link: '', text: '125 גרם חמאה רכה\nכוס סוכר\nביצה\nכוס וחצי קמח\nכפית תמצית וניל', notes: '' },
        { id: 'd4', title: 'קרואסון שקדים', category: 'לניסיון', link: 'https://www.instagram.com/reel/example', text: '', notes: 'לנסות בסופש עם יאלה' },
    ];

    function mockApi(path, method, body, token) {
        var s = mockStore();
        if (location.search.indexOf('demo=1') >= 0 && !s.users['demo']) {
            s.users['demo'] = { name: 'ירדן', email: 'demo', pass: 'demo', recipes: DEMO_RECIPES.slice() };
            mockSave(s);
        }
        var parts = path.split('/');
        if (path === '/api/signup' && method === 'POST') {
            var em = String(body.email || '').trim().toLowerCase();
            if (!em || !String(body.name || '').trim() || String(body.password || '').length < 6) return Promise.resolve({ status: 400, body: { error: 'missing' } });
            if (s.users[em]) return Promise.resolve({ status: 409, body: { error: 'exists' } });
            var recovery = ''; var rc = 'ABCDEF0123456789';
            for (var ri = 0; ri < 10; ri++) recovery += rc[Math.floor(Math.random() * rc.length)];
            s.users[em] = { name: String(body.name).trim(), email: em, pass: body.password, recovery: recovery, recipes: [] };
            mockSave(s);
            return Promise.resolve({ status: 200, body: { ok: true, recovery: recovery } });
        }
        if (path === '/api/login' && method === 'POST') {
            var e2 = String(body.email || '').trim().toLowerCase();
            var u = s.users[e2];
            if (!u || u.pass !== body.password) return Promise.resolve({ status: 401, body: { error: 'wrong' } });
            var t = 'mock-' + Math.random().toString(36).slice(2);
            s.sessions[t] = e2; mockSave(s);
            return Promise.resolve({ status: 200, body: { token: t, name: u.name } });
        }
        if (path === '/api/recover' && method === 'POST') {
            var e3 = String(body.email || '').trim().toLowerCase();
            var u3 = s.users[e3];
            if (!u3 || u3.recovery !== String(body.recovery || '').trim().toUpperCase()) return Promise.resolve({ status: 401, body: { error: 'wrong' } });
            if (String(body.password || '').length < 6) return Promise.resolve({ status: 400, body: { error: 'missing' } });
            u3.pass = body.password; mockSave(s);
            return Promise.resolve({ status: 200, body: { ok: true } });
        }
        var me = mockUser(s, token);
        if (!me) return Promise.resolve({ status: 401, body: { error: 'unauthorized' } });
        if (path === '/api/logout') { delete s.sessions[token]; mockSave(s); return Promise.resolve({ status: 200, body: { ok: true } }); }
        if (path === '/api/me') return Promise.resolve({ status: 200, body: { name: me.name, email: me.email } });
        if (path === '/api/recipes' && method === 'GET') return Promise.resolve({ status: 200, body: { recipes: me.recipes.slice().reverse() } });
        if (path === '/api/recipes' && method === 'POST') {
            var r = { id: 'r' + Date.now(), title: body.title, category: body.category, link: body.link || '', text: body.text || '', notes: body.notes || '', created: new Date().toISOString() };
            me.recipes.push(r); mockSave(s);
            return Promise.resolve({ status: 200, body: { recipe: r } });
        }
        if (parts[2] === 'recipes' && parts[3] && method === 'PUT') {
            for (var i = 0; i < me.recipes.length; i++) if (me.recipes[i].id === parts[3]) {
                me.recipes[i] = Object.assign({}, me.recipes[i], { title: body.title, category: body.category, link: body.link || '', text: body.text || '', notes: body.notes || '' });
                mockSave(s);
                return Promise.resolve({ status: 200, body: { recipe: me.recipes[i] } });
            }
            return Promise.resolve({ status: 404, body: { error: 'not found' } });
        }
        if (parts[2] === 'recipes' && parts[3] && method === 'DELETE') {
            me.recipes = me.recipes.filter(function (r) { return r.id !== parts[3]; });
            mockSave(s);
            return Promise.resolve({ status: 200, body: { ok: true } });
        }
        return Promise.resolve({ status: 404, body: { error: 'not found' } });
    }

    function api(path, method, body) {
        var token = getToken();
        if (MOCK) return mockApi(path, method, body, token);
        return fetch(API + path, {
            method: method,
            headers: Object.assign({ 'X-Recipes-Client': '1' }, body ? { 'Content-Type': 'application/json' } : {}, token ? { 'Authorization': 'Bearer ' + token } : {}),
            body: body ? JSON.stringify(body) : undefined,
        }).then(function (res) { return res.json().then(function (j) { return { status: res.status, body: j }; }); })
          .catch(function () { return { status: 0, body: { error: 'network' } }; });
    }

    // ---------- app state ----------
    var app = document.getElementById('app');
    var state = { user: null, recipes: null, route: '', openDetail: null, error: '', pending: false, recovery: '' };

    function route() {
        var h = location.hash.replace(/^#/, '');
        return h || '/';
    }
    window.addEventListener('hashchange', function () { state.openDetail = null; render(); });

    // ---------- views ----------
    function authView() {
        var mode = state.authMode || 'login';
        var h = '<div class="page"><div class="site-header"><h1>המתכונים שלי</h1>' +
            '<p class="fact">כל המתכונים שלך, במקום אחד</p></div>' +
            '<div class="gate-card">';
        if (mode === 'login') {
            h += '<div class="gate-label">התחברות</div>' +
                '<form class="gate" id="login-form">' +
                '<input class="gate-input" type="email" name="email" placeholder="מייל" autocomplete="email" required>' +
                '<input class="gate-input" type="password" name="password" placeholder="סיסמה" autocomplete="current-password" required>' +
                (state.error ? '<p class="gate-error">' + esc(state.error) + '</p>' : '') +
                '<button class="gate-submit" type="submit"' + (state.pending ? ' disabled' : '') + '>התחברות</button></form>' +
                '<button class="switch-link" data-mode="signup">אין לך משתמש? הרשמה</button>' +
                '<button class="switch-link" data-mode="recover">שכחתי סיסמה</button>';
        } else if (mode === 'signup') {
            h += '<div class="gate-label">הרשמה</div>' +
                '<form class="gate" id="signup-form">' +
                '<input class="gate-input" type="text" name="name" placeholder="שם" autocomplete="name" required>' +
                '<input class="gate-input" type="email" name="email" placeholder="מייל" autocomplete="email" required>' +
                '<input class="gate-input" type="password" name="password" placeholder="סיסמה (לפחות 6 תווים)" autocomplete="new-password" minlength="6" required>' +
                (state.error ? '<p class="gate-error">' + esc(state.error) + '</p>' : '') +
                '<button class="gate-submit" type="submit"' + (state.pending ? ' disabled' : '') + '>הרשמה</button></form>' +
                '<button class="switch-link" data-mode="login">יש לי כבר משתמש</button>';
        } else if (mode === 'recover') {
            h += '<div class="gate-label">איפוס סיסמה</div>' +
                '<p class="gate-note">מזינים את המייל ואת קוד השחזור שקיבלת בהרשמה, ובוחרים סיסמה חדשה.</p>' +
                '<form class="gate" id="recover-form">' +
                '<input class="gate-input" type="email" name="email" placeholder="מייל" autocomplete="email" required>' +
                '<input class="gate-input" type="text" name="recovery" placeholder="קוד שחזור" required>' +
                '<input class="gate-input" type="password" name="password" placeholder="סיסמה חדשה (לפחות 6 תווים)" minlength="6" required>' +
                (state.error ? '<p class="gate-error">' + esc(state.error) + '</p>' : '') +
                '<button class="gate-submit" type="submit"' + (state.pending ? ' disabled' : '') + '>איפוס</button></form>' +
                '<button class="switch-link" data-mode="login">חזרה להתחברות</button>';
        } else if (mode === 'recovery-shown') {
            h += '<div class="gate-label">נרשמת בהצלחה</div>' +
                '<p class="gate-note">זה קוד השחזור שלך. שמרי אותו במקום בטוח - איתו תוכלי לאפס את הסיסמה אם תשכחי. הוא מוצג רק עכשיו.</p>' +
                '<div class="gate"><div class="recovery-code">' + esc(state.recovery) + '</div>' +
                '<button class="gate-submit" id="recovery-continue">שמרתי, להתחברות</button></div>';
        }
        h += '</div></div>';
        app.innerHTML = h;

        var sw = app.querySelectorAll('.switch-link');
        for (var i = 0; i < sw.length; i++) sw[i].addEventListener('click', function () {
            state.authMode = this.getAttribute('data-mode'); state.error = ''; render();
        });
        var cont = document.getElementById('recovery-continue');
        if (cont) cont.addEventListener('click', function () { state.authMode = 'login'; state.error = ''; render(); });

        var lf = document.getElementById('login-form');
        if (lf) lf.addEventListener('submit', function (ev) {
            ev.preventDefault(); state.pending = true; state.error = ''; render();
            var f = ev.target ? ev.target : lf;
            var email = f.email.value, password = f.password.value;
            api('/api/login', 'POST', { email: email, password: password }).then(function (r) {
                state.pending = false;
                if (r.status === 200) { setToken(r.body.token); state.user = { name: r.body.name }; loadRecipes(); }
                else { state.error = r.body && r.body.error === 'locked' ? 'יותר מדי ניסיונות, נסי שוב בעוד כמה דקות' : 'מייל או סיסמה לא נכונים'; render(); }
            });
        });
        var sf = document.getElementById('signup-form');
        if (sf) sf.addEventListener('submit', function (ev) {
            ev.preventDefault(); state.pending = true; state.error = ''; render();
            var f = sf;
            api('/api/signup', 'POST', { name: f.name.value, email: f.email.value, password: f.password.value }).then(function (r) {
                state.pending = false;
                if (r.status === 200) { state.recovery = r.body.recovery; state.authMode = 'recovery-shown'; render(); }
                else { state.error = r.body && r.body.error === 'exists' ? 'כבר יש משתמש עם המייל הזה' : (r.body && r.body.error === 'locked' ? 'יותר מדי ניסיונות, נסי שוב בעוד כמה דקות' : 'חסרים פרטים או שהסיסמה קצרה מדי'); render(); }
            });
        });
        var rf = document.getElementById('recover-form');
        if (rf) rf.addEventListener('submit', function (ev) {
            ev.preventDefault(); state.pending = true; state.error = ''; render();
            api('/api/recover', 'POST', { email: rf.email.value, recovery: rf.recovery.value, password: rf.password.value }).then(function (r) {
                state.pending = false;
                if (r.status === 200) { state.authMode = 'login'; state.error = ''; render(); }
                else { state.error = 'מייל או קוד שחזור לא נכונים'; render(); }
            });
        });
    }

    function navHtml(active) {
        var h = '<nav class="icon-nav bottom">';
        for (var i = 0; i < CATS.length; i++) {
            var c = CATS[i];
            h += '<button class="nav-item' + (active === c.id ? ' active' : '') + '" data-cat="' + esc(c.id) + '">' + c.icon + '<span>' + esc(c.id) + '</span></button>';
        }
        h += '</nav>';
        return h;
    }

    function cardHtml(r, openId) {
        var c = catOf(r.category);
        var h = '<div class="recipe-card"><div class="recipe-head">' +
            '<p class="recipe-title">' + esc(r.title) + '</p>' +
            (c ? '<span class="recipe-cat">' + c.icon + esc(c.id) + '</span>' : '') +
            '</div><div class="item-actions">';
        if (r.text) h += '<button class="item-btn' + (openId === r.id + '-t' ? ' open' : '') + '" data-open="' + r.id + '-t">' + ICONS.book + 'המתכון<span class="chev">⌄</span></button>';
        if (r.link) h += '<button class="item-btn"><a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer">' + ICONS.link + 'קישור למתכון</a></button>';
        if (r.notes) h += '<button class="item-btn' + (openId === r.id + '-n' ? ' open' : '') + '" data-open="' + r.id + '-n">' + ICONS.note + 'הערות<span class="chev">⌄</span></button>';
        h += '<button class="item-btn edit-btn" data-edit="' + r.id + '" title="עריכה">' + ICONS.edit + '</button>' +
            '<button class="item-btn del-btn" data-del="' + r.id + '" title="מחיקה">' + ICONS.trash + '</button>' +
            '</div>';
        if (openId === r.id + '-t' && r.text) h += '<div class="item-details">' + esc(r.text) + '</div>';
        if (openId === r.id + '-n' && r.notes) h += '<div class="item-details">' + esc(r.notes) + '</div>';
        h += '</div>';
        return h;
    }

    function listHtml(recipes, openId) {
        if (!recipes.length) return '<div class="empty">עוד אין כאן מתכונים.<br>לוחצים על "הוספת מתכון" ומתחילים לאסוף</div>';
        var h = '';
        for (var i = 0; i < recipes.length; i++) h += cardHtml(recipes[i], openId);
        return h;
    }

    function statsHtml(recipes) {
        var h = '<div class="stats">';
        for (var i = 0; i < CATS.length; i++) {
            var n = recipes.filter(function (r) { return r.category === CATS[i].id; }).length;
            h += '<div class="stat"><span class="stat-num">' + n + '</span><span class="stat-label">' + esc(CATS[i].id) + '</span></div>';
        }
        h += '</div>';
        return h;
    }

    function formHtml(r) {
        var editing = !!r;
        r = r || { title: '', category: 'ארוחה', link: '', text: '', notes: '' };
        var h = '<div class="page"><div class="site-header"><h1>' + (editing ? 'עריכת מתכון' : 'הוספת מתכון') + '</h1></div>' +
            '<div class="gate-card"><form class="gate" id="recipe-form">' +
            '<input class="gate-input" type="text" name="title" placeholder="שם המתכון" value="' + esc(r.title) + '" required>' +
            '<select class="gate-input" name="category">';
        for (var i = 0; i < CATS.length; i++) h += '<option value="' + esc(CATS[i].id) + '"' + (r.category === CATS[i].id ? ' selected' : '') + '>' + esc(CATS[i].id) + '</option>';
        h += '</select>' +
            '<input class="gate-input" type="url" name="link" placeholder="קישור למתכון (לא חובה)" value="' + esc(r.link) + '">' +
            '<textarea name="text" placeholder="מתכון כתוב: מצרכים והוראות (לא חובה)">' + esc(r.text) + '</textarea>' +
            '<textarea name="notes" placeholder="הערות שלי (לא חובה)" style="min-height:70px">' + esc(r.notes) + '</textarea>' +
            (state.error ? '<p class="gate-error">' + esc(state.error) + '</p>' : '') +
            '<button class="gate-submit" type="submit"' + (state.pending ? ' disabled' : '') + '>' + (editing ? 'שמירה' : 'הוספה') + '</button>' +
            '<button class="switch-link" id="cancel-form">ביטול</button>' +
            '</form></div></div>' + navHtml('');
        return h;
    }

    function render() {
        if (!state.user) { authView(); return; }
        var rt = route();

        if (rt.indexOf('/add') === 0 || rt.indexOf('/edit/') === 0) {
            var editId = rt.indexOf('/edit/') === 0 ? rt.slice(6) : null;
            var rec = editId ? (state.recipes || []).filter(function (r) { return r.id === editId; })[0] : null;
            app.innerHTML = formHtml(rec);
            var form = document.getElementById('recipe-form');
            form.addEventListener('submit', function (ev) {
                ev.preventDefault();
                var body = { title: form.title.value.trim(), category: form.category.value, link: form.link.value.trim(), text: form.text.value, notes: form.notes.value };
                if (!body.title) return;
                if (!body.link && !body.text.trim()) { state.error = 'צריך לפחות קישור או מתכון כתוב'; render(); return; }
                state.pending = true; state.error = ''; render();
                var p = editId ? api('/api/recipes/' + encodeURIComponent(editId), 'PUT', body) : api('/api/recipes', 'POST', body);
                p.then(function (r2) {
                    state.pending = false;
                    if (r2.status === 200) { location.hash = '#/'; loadRecipes(true); }
                    else { state.error = 'לא נשמר, נסי שוב'; render(); }
                });
            });
            document.getElementById('cancel-form').addEventListener('click', function () { location.hash = '#/'; });
            bindNav();
            return;
        }

        var cat = rt.indexOf('/cat/') === 0 ? decodeURIComponent(rt.slice(5)) : '';
        var all = state.recipes || [];
        var list = cat ? all.filter(function (r) { return r.category === cat; }) : all;

        var h = '<div class="page"><div class="site-header">' +
            '<h1><button id="home-btn">המתכונים שלי</button></h1>' +
            '<p class="fact">שלום ' + esc(state.user.name) + ' <button class="switch-link" id="logout-btn" style="display:inline;margin:0">' + 'התנתקות</button></p>' +
            '</div>';
        if (!cat) h += statsHtml(all);
        else h += '<div class="cat-chips"><button class="cat-chip" id="all-chip">כל המתכונים</button><span class="cat-chip active">' + esc(cat) + '</span></div>';
        h += '<div class="add-row"><button class="add-btn" id="add-btn">' + ICONS.plus + 'הוספת מתכון</button></div>';
        h += '<div class="group-label big">' + (cat ? esc(cat) : 'כל המתכונים') + '</div>';
        h += listHtml(list, state.openDetail);
        h += '</div>' + navHtml(cat);
        app.innerHTML = h;

        document.getElementById('add-btn').addEventListener('click', function () { location.hash = '#/add'; });
        document.getElementById('home-btn').addEventListener('click', function () { location.hash = '#/'; });
        document.getElementById('logout-btn').addEventListener('click', function () {
            api('/api/logout', 'POST', {}).then(function () {});
            setToken(''); state.user = null; state.recipes = null; state.authMode = 'login'; render();
        });
        var allChip = document.getElementById('all-chip');
        if (allChip) allChip.addEventListener('click', function () { location.hash = '#/'; });

        var openers = app.querySelectorAll('[data-open]');
        for (var i = 0; i < openers.length; i++) openers[i].addEventListener('click', function () {
            var id = this.getAttribute('data-open');
            state.openDetail = state.openDetail === id ? null : id;
            render();
        });
        var edits = app.querySelectorAll('[data-edit]');
        for (var j = 0; j < edits.length; j++) edits[j].addEventListener('click', function () {
            location.hash = '#/edit/' + this.getAttribute('data-edit');
        });
        var dels = app.querySelectorAll('[data-del]');
        for (var k = 0; k < dels.length; k++) dels[k].addEventListener('click', function () {
            var id = this.getAttribute('data-del');
            var rec = (state.recipes || []).filter(function (r) { return r.id === id; })[0];
            var label = rec && rec.title ? ' את \"' + rec.title + '\"?' : ' את המתכון?';
            if (!confirm('למחוק' + label)) return;
            api('/api/recipes/' + encodeURIComponent(id), 'DELETE').then(function () { loadRecipes(true); });
        });
        bindNav();
    }

    function bindNav() {
        var items = app.querySelectorAll('.nav-item[data-cat]');
        for (var i = 0; i < items.length; i++) items[i].addEventListener('click', function () {
            location.hash = '#/cat/' + encodeURIComponent(this.getAttribute('data-cat'));
        });
    }

    function loadRecipes(skipRender) {
        api('/api/recipes', 'GET').then(function (r) {
            if (r.status === 200) { state.recipes = r.body.recipes; }
            if (!skipRender) render(); else render();
        });
    }

    // ---------- boot ----------
    if (getToken()) {
        api('/api/me', 'GET').then(function (r) {
            if (r.status === 200) { state.user = { name: r.body.name, email: r.body.email }; loadRecipes(); }
            else { setToken(''); render(); }
        });
    }
    render();
})();
