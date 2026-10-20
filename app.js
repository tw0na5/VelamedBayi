'use strict';
// Velamed Bayi – harita, iş panosu, özet
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const R = { 'Yıldırım': '--y', 'Tuna': '--t', 'Hakan': '--h' };
const SORUMLULAR = Object.keys(R);
const DUR = [['yapilacak', 'Yapılacak'], ['devam', 'Devam ediyor'], ['tamam', 'Tamamlandı']];
const DN = Object.fromEntries(DUR);
const ROLLER = [['yonetici', 'Yönetici'], ['duzenleyici', 'Düzenleyici'], ['kendi', 'Kendi illeri'], ['izleyici', 'İzleyici']];
const RN = Object.fromEntries(ROLLER);
const DOMAIN = '@bayi.local';
const ILLER = P.map(p => p.n).sort((a, b) => a.localeCompare(b, 'tr'));

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Durum ----
let D = {};      // il -> {s,bayi,yetkili,tel,not}
let K = {};      // kart id -> kart
let U = {};      // user_id -> {kullanici_adi, rol, sorumlu_adi}
let YC = {};     // kart id -> yorum sayısı
let EK = {};     // kart id -> [ek]
let ME = null;   // {id, rol, sorumlu_adi, kullanici_adi}
let cur = null;  // seçili il
const hide = new Set();

// ---- Yardımcılar ----
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = v => v.trim().toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/i̇/g, 'i');
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmt = d => d ? d.slice(0, 10).split('-').reverse().join('.') : '';
const fmtTs = ts => ts ? new Date(ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const sorOf = il => (D[il] && D[il].s) || '';
const isLate = c => c.durum !== 'tamam' && c.tarih && c.tarih < today();
const uname = id => (U[id] && U[id].kullanici_adi) || '';
const initials = n => (n || '?').replace(/[^a-z0-9çğıöşü]/gi, ' ').trim().split(/\s+|[._-]/).map(x => x[0]).join('').slice(0, 2) || '?';
const kb = n => n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const ILN = Object.fromEntries(ILLER.map(n => [norm(n), n]));
function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3500); }

// ---- Yetki ----
const rol = () => (ME && ME.rol) || 'izleyici';
const canAll = () => ['yonetici', 'duzenleyici'].includes(rol());
const canEditIl = il => canAll() || (rol() === 'kendi' && !!ME.sorumlu_adi && sorOf(il) === ME.sorumlu_adi);
const canWriteAny = () => rol() !== 'izleyici';

// ---- Görünümler ----
const views = { map: ['vMap', 'tMap'], board: ['vBoard', 'tBoard'], sum: ['vSum', 'tSum'] };
let view = 'map';
function show(v) {
  view = v;
  for (const [k, [sec, tab]] of Object.entries(views)) { $(sec).hidden = k !== v; $(tab).setAttribute('aria-selected', k === v); }
  if (v === 'board') board();
  if (v === 'sum') summary();
  try { history.replaceState(null, '', v === 'map' ? location.pathname : '#' + (v === 'board' ? 'pano' : 'ozet')); } catch (e) { }
}
$('tMap').onclick = () => show('map');
$('tBoard').onclick = () => show('board');
$('tSum').onclick = () => show('sum');
function refresh() { paint(); if (view === 'board') board(); if (view === 'sum') summary(); ilKart(); }

// ================= HARİTA =================
const svg = $('svg');
const LB = {}, WARN = {}, CEN = {};
P.forEach(p => {
  const e = document.createElementNS(NS, 'path');
  e.setAttribute('d', p.d); e.setAttribute('tabindex', '0'); e.dataset.n = p.n;
  e.setAttribute('aria-label', p.n);
  e.onclick = () => sel(p.n);
  e.onkeydown = k => { if (k.key === 'Enter') sel(p.n); };
  e.onmouseenter = () => {
    const r = D[p.n], late = Object.values(K).filter(c => c.il === p.n && isLate(c)).length;
    const open = Object.values(K).filter(c => c.il === p.n && c.durum !== 'tamam').length;
    $('tip').textContent = p.n + (r && r.s ? ' — ' + r.s + (r.bayi ? ' · ' + r.bayi : '') : ' — atanmamış') +
      (open ? ` · ${open} açık iş` : '') + (late ? ` · ${late} geciken` : '');
  };
  svg.appendChild(e);
});
function center(d) {
  let best = null, ba = 0;
  d.split('Z').filter(Boolean).forEach(s => {
    const pts = s.replace('M', '').split('L').map(q => q.split(',').map(Number));
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length], f = x1 * y2 - x2 * y1;
      a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
    }
    if (Math.abs(a) > ba) { ba = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
  });
  return best;
}
const lg = document.createElementNS(NS, 'g'); svg.appendChild(lg);
const wg = document.createElementNS(NS, 'g'); svg.appendChild(wg);
P.forEach(p => {
  const c = center(p.d); if (!c) return; CEN[p.n] = c;
  const tx = document.createElementNS(NS, 'text');
  tx.setAttribute('class', 'lbl'); tx.setAttribute('x', c[0].toFixed(1)); tx.setAttribute('y', c[1].toFixed(1));
  tx.textContent = p.n; lg.appendChild(tx); LB[p.n] = tx;
});

function paint() {
  const cnt = { 'Yıldırım': 0, 'Tuna': 0, 'Hakan': 0 };
  const lateBy = {};
  Object.values(K).forEach(c => { if (isLate(c)) lateBy[c.il] = (lateBy[c.il] || 0) + 1; });
  svg.querySelectorAll('path').forEach(e => {
    const n = e.dataset.n, s = sorOf(n); if (s) cnt[s]++;
    e.style.fill = s ? `var(${R[s]})` : 'var(--empty)';
    const dim = !!s && hide.has(s);
    e.classList.toggle('dim', dim); e.classList.toggle('sel', n === cur);
    if (LB[n]) LB[n].classList.toggle('dim', dim);
  });
  // Gecikme işaretleri
  wg.innerHTML = '';
  Object.entries(lateBy).forEach(([il, k]) => {
    const c = CEN[il]; if (!c) return;
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'warn');
    const w = LB[il] ? LB[il].getComputedTextLength?.() || 30 : 30;
    const x = c[0] + w / 2 + 6, y = c[1] - 1;
    g.innerHTML = `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5"></circle><text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${k > 9 ? '9+' : k}</text><title>${esc(il)}: ${k} geciken iş</title>`;
    wg.appendChild(g);
  });
  const leg = $('leg'); leg.innerHTML = '';
  SORUMLULAR.forEach(s => {
    const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', !hide.has(s));
    b.innerHTML = `<span class="dot" style="background:var(${R[s]})"></span>${s} <small>${cnt[s]} il</small>`;
    b.onclick = () => { hide.has(s) ? hide.delete(s) : hide.add(s); paint(); };
    leg.appendChild(b);
  });
  const lateN = Object.values(lateBy).reduce((a, b) => a + b, 0);
  const li = document.createElement('span'); li.className = 'chip'; li.style.cursor = 'default';
  li.innerHTML = `<span class="badge late">!</span> Geciken iş <small>${lateN}</small>`;
  leg.appendChild(li);
  $('stats').textContent = `Atanmamış il: ${81 - cnt['Yıldırım'] - cnt.Tuna - cnt.Hakan}`;
}

// ---- İl paneli ----
const timers = {};
function saveIl(n) {
  clearTimeout(timers[n]); $('sync').textContent = 'Kaydediliyor…';
  timers[n] = setTimeout(async () => {
    const r = D[n];
    const { error } = await sb.from('iller').upsert({ il: n, sorumlu: r.s || null, bayi: r.bayi || null, yetkili: r.yetkili || null, tel: r.tel || null, notlar: r.not || null });
    $('sync').textContent = error ? 'Kaydedilemedi: ' + error.message : 'Kaydedildi · herkes görüyor';
  }, 600);
}
function sel(n) {
  cur = n; const r = D[n] || (D[n] = { s: '' });
  const ed = canEditIl(n), dis = ed ? '' : 'disabled';
  const sorDis = canAll() ? '' : 'disabled';
  $('side').innerHTML = `<h2>${esc(n)}</h2>
<label>Sorumlu<select id="f_s" ${sorDis}><option value="">— Atanmamış —</option>${SORUMLULAR.map(s => `<option ${r.s === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
<label>Bayi adı<input id="f_bayi" value="${esc(r.bayi)}" ${dis}></label>
<label>Yetkili kişi<input id="f_yetkili" value="${esc(r.yetkili)}" ${dis}></label>
<label>Telefon<input id="f_tel" value="${esc(r.tel)}" ${dis}></label>
<label>Notlar<textarea id="f_not" ${dis}>${esc(r.not)}</textarea></label>
${ed ? '' : '<p class="stats">Bu ili düzenleme yetkiniz yok.</p>'}
<div><label>İşler</label><div class="jobs" id="jobs"></div></div>
<div class="row">${ed ? '<button class="b p" id="j_add">+ Bu ile kart ekle</button>' : ''}<button class="b" id="j_pano">Panoda göster</button></div>`;
  ['s', 'bayi', 'yetkili', 'tel', 'not'].forEach(k => {
    const el = $('f_' + k);
    el.oninput = () => { r[k] = el.value; saveIl(n); if (k === 's') { paint(); } };
  });
  if (ed) $('j_add').onclick = () => openCard(null, { il: n });
  $('j_pano').onclick = () => { $('fIl').value = n; show('board'); };
  ilKart(); paint();
}
function ilKart() {
  const j = $('jobs'); if (!j || !cur) return;
  const ord = { yapilacak: 0, devam: 1, tamam: 2 };
  const items = Object.values(K).filter(c => c.il === cur).sort((a, b) => ord[a.durum] - ord[b.durum] || a.sira - b.sira);
  j.innerHTML = items.length ? '' : '<span class="stats">Bu ilde henüz kart yok.</span>';
  items.forEach(c => {
    const r = document.createElement('button'); r.className = 'krow';
    r.innerHTML = `<span class="t"></span><span class="badges">${isLate(c) ? '<span class="badge late">! Gecikti</span>' : ''}<span class="badge d-${c.durum}">${DN[c.durum]}</span></span>`;
    r.querySelector('.t').textContent = c.baslik;
    r.onclick = () => openCard(c.id); j.appendChild(r);
  });
}

// ================= PANO =================
let dragId = null;
$('fIl').innerHTML = '<option value="">Tüm iller</option>' + ILLER.map(n => `<option>${n}</option>`).join('');
$('kIl').innerHTML = '<option value="">İl seçin</option>' + ILLER.map(n => `<option>${n}</option>`).join('');
$('kD').innerHTML = DUR.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
['fIl', 'fSor', 'fAt', 'fLate'].forEach(x => $(x).onchange = board);
$('fQ').oninput = board;
function fillUserSelects() {
  const users = Object.entries(U).sort((a, b) => a[1].kullanici_adi.localeCompare(b[1].kullanici_adi, 'tr'));
  const fa = $('fAt'), v = fa.value;
  fa.innerHTML = '<option value="">Herkes</option><option value="me">Bana atananlar</option><option value="none">Atanmamış</option>' +
    users.map(([id, u]) => `<option value="${id}">${esc(u.kullanici_adi)}</option>`).join('');
  fa.value = v;
  $('kAt').innerHTML = '<option value="">— Kimse —</option>' + users.map(([id, u]) => `<option value="${id}">${esc(u.kullanici_adi)}</option>`).join('');
}
const sorted = d => Object.values(K).filter(c => c.durum === d).sort((a, b) => a.sira - b.sira);
function visible(c) {
  const q = $('fQ').value.trim().toLocaleLowerCase('tr'), at = $('fAt').value;
  if ($('fIl').value && c.il !== $('fIl').value) return false;
  if ($('fSor').value && sorOf(c.il) !== $('fSor').value) return false;
  if (at === 'me' && c.atanan !== ME?.id) return false;
  if (at === 'none' && c.atanan) return false;
  if (at && at !== 'me' && at !== 'none' && c.atanan !== at) return false;
  if ($('fLate').checked && !isLate(c)) return false;
  if (q && !(c.baslik + ' ' + (c.aciklama || '') + ' ' + c.il + ' ' + uname(c.atanan)).toLocaleLowerCase('tr').includes(q)) return false;
  return true;
}
function cardEl(c) {
  const s = sorOf(c.il), late = isLate(c), ed = canEditIl(c.il);
  const e = document.createElement('div'); e.className = 'card' + (late ? ' is-late' : '');
  e.draggable = ed; e.dataset.id = c.id; e.tabIndex = 0; e.setAttribute('role', 'button');
  if (s) e.style.borderLeftColor = `var(${R[s]})`;
  const nY = YC[c.id] || 0, nE = (EK[c.id] || []).length, an = uname(c.atanan);
  e.innerHTML = `<div class="tt"></div><div class="meta">
<span class="pill">${s ? `<span class="dot" style="background:var(${R[s]})"></span>` : ''}${esc(c.il)}</span>
${late ? `<span class="badge late">! Gecikti · ${fmt(c.tarih)}</span>` : c.tarih ? `<span>${fmt(c.tarih)}</span>` : ''}
${c.aciklama ? '<span class="ico" title="Açıklama var">☰</span>' : ''}
${nY ? `<span class="ico" title="${nY} yorum">💬 ${nY}</span>` : ''}
${nE ? `<span class="ico" title="${nE} dosya">📎 ${nE}</span>` : ''}
${an ? `<span class="av" title="Atanan: ${esc(an)}">${esc(initials(an))}</span>` : ''}</div>`;
  e.querySelector('.tt').textContent = c.baslik;
  e.onclick = () => openCard(c.id);
  e.onkeydown = k => { if (k.key === 'Enter') openCard(c.id); };
  e.ondragstart = ev => { dragId = c.id; e.classList.add('drag'); ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', c.id); } catch (_) { } };
  e.ondragend = () => { dragId = null; e.classList.remove('drag'); document.querySelectorAll('.list.over').forEach(l => l.classList.remove('over')); };
  return e;
}
function board() {
  if ($('vBoard').hidden) return;
  const cols = $('cols'); cols.innerHTML = ''; let tot = 0, lateN = 0;
  DUR.forEach(([d, lab]) => {
    const items = sorted(d).filter(visible); tot += items.length; lateN += items.filter(isLate).length;
    const col = document.createElement('div'); col.className = 'col';
    col.innerHTML = `<h3>${lab}<small>${items.length}</small></h3>`;
    const list = document.createElement('div'); list.className = 'list'; list.dataset.d = d;
    items.forEach(c => list.appendChild(cardEl(c)));
    list.ondragover = ev => { if (!dragId) return; ev.preventDefault(); list.classList.add('over'); };
    list.ondragleave = ev => { if (!list.contains(ev.relatedTarget)) list.classList.remove('over'); };
    list.ondrop = ev => {
      ev.preventDefault(); list.classList.remove('over'); if (!dragId) return;
      const els = [...list.querySelectorAll('.card')].filter(x => x.dataset.id !== dragId);
      let idx = els.findIndex(x => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (idx < 0) idx = els.length;
      moveCard(dragId, d, els[idx - 1] && K[els[idx - 1].dataset.id], els[idx] && K[els[idx].dataset.id]);
    };
    col.appendChild(list);
    if (canWriteAny()) {
      const add = document.createElement('button'); add.className = 'addc'; add.textContent = '+ Kart ekle';
      add.onclick = () => quickAdd(col, add, d);
      col.appendChild(add);
    }
    cols.appendChild(col);
  });
  $('bstat').textContent = tot + ' kart' + (lateN ? ` · ${lateN} geciken` : '');
}
function quickAdd(col, add, d) {
  add.hidden = true;
  const f = document.createElement('div'); f.className = 'comp';
  const pre = $('fIl').value || cur;
  const opts = ILLER.filter(canEditIl);
  f.innerHTML = `<textarea placeholder="Kart başlığı"></textarea><select><option value="">İl seçin</option>${opts.map(n => `<option ${n === pre ? 'selected' : ''}>${n}</option>`).join('')}</select><div class="row"><button class="b p">Ekle</button><button class="b" type="button">Vazgeç</button></div><div class="err"></div>`;
  const ta = f.querySelector('textarea'), se = f.querySelector('select'), [ok, no] = f.querySelectorAll('button'), er = f.querySelector('.err');
  const close = () => { f.remove(); add.hidden = false; };
  const go = async () => {
    const b = ta.value.trim(); if (!b) { ta.focus(); return; }
    if (!se.value) { er.textContent = 'Bir il seçin.'; return; }
    const last = sorted(d).pop(); ok.disabled = true;
    const { data, error } = await sb.from('isler').insert({ il: se.value, baslik: b, durum: d, sira: last ? last.sira + 1 : Date.now() / 1000 }).select().single();
    ok.disabled = false;
    if (error) { er.textContent = 'Eklenemedi: ' + error.message; return; }
    K[data.id] = data; ta.value = ''; er.textContent = ''; refresh();
    const again = document.querySelector(`.list[data-d="${d}"]`)?.parentElement; if (again) quickAdd(again, again.querySelector('.addc'), d);
  };
  ok.onclick = go;
  ta.onkeydown = k => { if (k.key === 'Enter' && !k.shiftKey) { k.preventDefault(); go(); } if (k.key === 'Escape') close(); };
  no.onclick = close;
  col.insertBefore(f, add); ta.focus();
}
async function moveCard(id, d, prev, next) {
  const c = K[id]; if (!c) return;
  const s = prev && next ? (prev.sira + next.sira) / 2 : prev ? prev.sira + 1 : next ? next.sira - 1 : Date.now() / 1000;
  if (c.durum === d && c.sira === s) return;
  const old = { durum: c.durum, sira: c.sira };
  K[id] = { ...c, durum: d, sira: s }; refresh();
  const { data, error } = await sb.from('isler').update({ durum: d, sira: s }).eq('id', id).select().single();
  if (error) { K[id] = { ...K[id], ...old }; refresh(); toast('Taşınamadı: ' + error.message); return; }
  K[id] = data; refresh();
}

// ---- Kart penceresi ----
let editId = null, delArm = false;
function openCard(id, pre = {}) {
  editId = id;
  const c = id ? K[id] : { baslik: '', il: pre.il || $('fIl').value || cur || '', durum: pre.durum || 'yapilacak', tarih: '', aciklama: '', atanan: '' };
  const ed = id ? canEditIl(c.il) : canWriteAny();
  $('kTitle').textContent = id ? (ed ? 'Kartı düzenle' : 'Kart') : 'Yeni kart';
  $('kB').value = c.baslik; $('kIl').value = c.il; $('kD').value = c.durum; $('kT').value = c.tarih || '';
  $('kA').value = c.aciklama || ''; $('kAt').value = c.atanan || '';
  [...$('kIl').options].forEach(o => o.disabled = !!o.value && !canEditIl(o.value) && o.value !== c.il);
  ['kB', 'kIl', 'kD', 'kT', 'kA', 'kAt'].forEach(x => $(x).disabled = !ed);
  $('kSave').hidden = !ed;
  $('kLate').innerHTML = id && isLate(c) ? '<span class="badge late">! Gecikti</span>' : '';
  $('kMeta').textContent = id ? 'Oluşturulma: ' + fmtTs(c.created_at) + (c.tamamlanma ? ' · Tamamlanma: ' + fmtTs(c.tamamlanma) : '') : '';
  $('kErr').textContent = ''; $('kDel').hidden = !id || !ed; delArm = false; $('kDel').textContent = 'Sil'; $('kDel').classList.remove('danger');
  $('kExtra').hidden = !id; $('kNew').hidden = !!id;
  $('kUp').hidden = !ed; $('kComRow').hidden = !canWriteAny(); $('kUpMsg').textContent = ''; $('kCom').value = '';
  if (id) { renderFiles(); loadTimeline(); }
  if (!$('dlg').open) $('dlg').showModal();
  if (ed && !id) $('kB').focus();
}
$('kCancel').onclick = () => $('dlg').close();
$('dlg').addEventListener('close', () => { editId = null; });
$('kDel').onclick = async () => {
  if (!delArm) { delArm = true; $('kDel').textContent = 'Silmek için tekrar tıklayın'; $('kDel').classList.add('danger'); return; }
  const files = (EK[editId] || []).map(f => f.yol);
  if (files.length) await sb.storage.from('ekler').remove(files);
  const { error } = await sb.from('isler').delete().eq('id', editId);
  if (error) { $('kErr').textContent = 'Silinemedi: ' + error.message; return; }
  delete K[editId]; delete EK[editId]; $('dlg').close(); refresh(); toast('Kart silindi');
};
$('kf').onsubmit = async e => {
  e.preventDefault();
  if (!$('kB').value.trim() || !$('kIl').value) { $('kErr').textContent = 'Başlık ve il gerekli.'; return; }
  const row = { baslik: $('kB').value.trim(), il: $('kIl').value, durum: $('kD').value, tarih: $('kT').value || null, aciklama: $('kA').value.trim() || null, atanan: $('kAt').value || null };
  $('kSave').disabled = true; let res;
  if (editId) {
    if (K[editId].durum !== row.durum) { const l = sorted(row.durum).pop(); row.sira = l ? l.sira + 1 : Date.now() / 1000; }
    res = await sb.from('isler').update(row).eq('id', editId).select().single();
  } else {
    const l = sorted(row.durum).pop(); row.sira = l ? l.sira + 1 : Date.now() / 1000;
    res = await sb.from('isler').insert(row).select().single();
  }
  $('kSave').disabled = false;
  if (res.error) { $('kErr').textContent = 'Kaydedilemedi: ' + res.error.message; return; }
  K[res.data.id] = res.data; refresh();
  if (!editId) { openCard(res.data.id); toast('Kart eklendi'); } else { toast('Kaydedildi'); openCard(editId); }
};

// Dosyalar
function renderFiles() {
  const box = $('kFiles'), list = (EK[editId] || []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ed = canEditIl(K[editId].il);
  box.innerHTML = list.length ? '' : '<span class="stats">Dosya yok.</span>';
  list.forEach(f => {
    const r = document.createElement('div'); r.className = 'file';
    r.innerHTML = `<span>📎</span><button class="link" type="button"></button><span class="sp"></span><span class="stats">${f.boyut ? kb(f.boyut) : ''}</span>${ed ? '<button class="x" type="button" title="Dosyayı sil">✕</button>' : ''}`;
    r.querySelector('.link').textContent = f.ad;
    r.querySelector('.link').onclick = async () => {
      const w = window.open('', '_blank');
      const { data, error } = await sb.storage.from('ekler').createSignedUrl(f.yol, 300);
      if (error) { w && w.close(); toast('Dosya açılamadı: ' + error.message); return; }
      if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
    };
    const x = r.querySelector('.x');
    if (x) x.onclick = async () => {
      if (x.dataset.arm !== '1') { x.dataset.arm = '1'; x.textContent = 'Sil?'; x.classList.add('danger'); return; }
      await sb.storage.from('ekler').remove([f.yol]);
      const { error } = await sb.from('ekler').delete().eq('id', f.id);
      if (error) { toast('Silinemedi: ' + error.message); return; }
      EK[editId] = (EK[editId] || []).filter(z => z.id !== f.id); renderFiles(); refresh();
    };
    box.appendChild(r);
  });
}
$('kUp').onclick = () => $('kFile').click();
$('kFile').onchange = async () => {
  const files = [...$('kFile').files]; $('kFile').value = ''; if (!files.length || !editId) return;
  const id = editId;
  for (const f of files) {
    if (f.size > 20 * 1048576) { toast(f.name + ' 20 MB sınırını aşıyor'); continue; }
    $('kUpMsg').textContent = f.name + ' yükleniyor…';
    const safe = f.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80);
    const yol = `${id}/${crypto.randomUUID()}-${safe}`;
    const up = await sb.storage.from('ekler').upload(yol, f, { contentType: f.type || 'application/octet-stream' });
    if (up.error) { $('kUpMsg').textContent = 'Yüklenemedi: ' + up.error.message; continue; }
    const { data, error } = await sb.from('ekler').insert({ kart_id: id, yol, ad: f.name, boyut: f.size, tur: f.type || null }).select().single();
    if (error) { await sb.storage.from('ekler').remove([yol]); $('kUpMsg').textContent = 'Kaydedilemedi: ' + error.message; continue; }
    (EK[id] = EK[id] || []).push(data);
    $('kUpMsg').textContent = '';
    if (editId === id) renderFiles();
  }
  refresh();
};

// Yorumlar ve geçmiş
let TL = [];
async function loadTimeline() {
  const id = editId; $('kTl').innerHTML = '<span class="stats">Yükleniyor…</span>';
  const { data, error } = await sb.from('kart_olaylari').select('*').eq('kart_id', id).order('created_at', { ascending: false });
  if (editId !== id) return;
  if (error) { $('kTl').innerHTML = `<span class="err">${esc(error.message)}</span>`; return; }
  TL = data; renderTimeline();
}
function renderTimeline() {
  const box = $('kTl'); box.innerHTML = TL.length ? '' : '<span class="stats">Henüz kayıt yok.</span>';
  TL.forEach(o => {
    const r = document.createElement('div'); r.className = 'ev ' + o.tur;
    const who = uname(o.yazan) || 'Biri';
    const canDel = o.tur === 'yorum' && (o.yazan === ME?.id || rol() === 'yonetici');
    if (o.tur === 'yorum') {
      r.innerHTML = `<span class="av" style="margin:0">${esc(initials(who))}</span><div class="body"><div class="row" style="gap:6px"><span class="who2">${esc(who)}</span><span class="when">${fmtTs(o.created_at)}</span><span class="sp"></span>${canDel ? '<button class="x" title="Yorumu sil">✕</button>' : ''}</div><div class="bubble"></div></div>`;
      r.querySelector('.bubble').textContent = o.metin;
      const x = r.querySelector('.x');
      if (x) x.onclick = async () => {
        if (x.dataset.arm !== '1') { x.dataset.arm = '1'; x.textContent = 'Sil?'; x.classList.add('danger'); return; }
        const { error } = await sb.from('kart_olaylari').delete().eq('id', o.id);
        if (error) { toast('Silinemedi: ' + error.message); return; }
        TL = TL.filter(z => z.id !== o.id); YC[editId] = Math.max(0, (YC[editId] || 1) - 1); renderTimeline(); refresh();
      };
    } else {
      r.innerHTML = `<span style="width:22px;text-align:center">•</span><div class="body"><span class="who2"></span> <span class="m"></span> <span class="when">${fmtTs(o.created_at)}</span></div>`;
      r.querySelector('.who2').textContent = who; r.querySelector('.m').textContent = o.metin.charAt(0).toLocaleLowerCase('tr') + o.metin.slice(1);
    }
    box.appendChild(r);
  });
}
$('kComAdd').onclick = async () => {
  const m = $('kCom').value.trim(); if (!m || !editId) return;
  $('kComAdd').disabled = true;
  const { data, error } = await sb.from('kart_olaylari').insert({ kart_id: editId, tur: 'yorum', metin: m, yazan: ME.id }).select().single();
  $('kComAdd').disabled = false;
  if (error) { toast('Yorum eklenemedi: ' + error.message); return; }
  $('kCom').value = ''; if (!TL.some(z => z.id === data.id)) { TL.unshift(data); YC[editId] = (YC[editId] || 0) + 1; } renderTimeline(); refresh();
};
$('kCom').onkeydown = k => { if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) $('kComAdd').click(); };

// ================= ÖZET =================
function summary() {
  const v = $('vSum'); if (v.hidden) return;
  const cards = Object.values(K), ay = today().slice(0, 7);
  const open = cards.filter(c => c.durum !== 'tamam'), late = cards.filter(isLate);
  const doneM = cards.filter(c => c.durum === 'tamam' && (c.tamamlanma || '').slice(0, 7) === ay);
  const assigned = ILLER.filter(sorOf).length;
  const monthName = new Date().toLocaleDateString('tr-TR', { month: 'long' });
  const per = SORUMLULAR.map(s => {
    const iller = ILLER.filter(n => sorOf(n) === s), cs = cards.filter(c => sorOf(c.il) === s);
    return { s, il: iller.length, open: cs.filter(c => c.durum !== 'tamam').length, late: cs.filter(isLate).length, done: cs.filter(c => c.durum === 'tamam' && (c.tamamlanma || '').slice(0, 7) === ay).length };
  });
  const users = Object.entries(U).map(([id, u]) => {
    const cs = cards.filter(c => c.atanan === id);
    return { n: u.kullanici_adi, open: cs.filter(c => c.durum !== 'tamam').length, late: cs.filter(isLate).length, done: cs.filter(c => c.durum === 'tamam' && (c.tamamlanma || '').slice(0, 7) === ay).length };
  }).filter(x => x.open || x.late || x.done).sort((a, b) => b.open - a.open);
  const unassigned = open.filter(c => !c.atanan).length;
  const byIl = {};
  cards.forEach(c => { const b = byIl[c.il] || (byIl[c.il] = { open: 0, done: 0 }); c.durum === 'tamam' ? b.done++ : b.open++; });
  const top = Object.entries(byIl).sort((a, b) => (b[1].open + b[1].done) - (a[1].open + a[1].done) || a[0].localeCompare(b[0], 'tr')).slice(0, 10);
  const max = Math.max(1, ...top.map(([, b]) => b.open + b.done));
  const lateList = late.sort((a, b) => a.tarih.localeCompare(b.tarih)).slice(0, 8);

  v.innerHTML = `
<div class="kpis">
<div class="kpi"><b>${assigned}<small style="font-size:1rem;color:var(--mut)"> / 81</small></b><span>Sorumlusu atanmış il</span></div>
<div class="kpi"><b>${open.length}</b><span>Açık iş</span></div>
<div class="kpi warnk"><b>${late.length}</b><span>! Geciken iş</span></div>
<div class="kpi"><b>${doneM.length}</b><span>${monthName} ayında tamamlanan</span></div>
</div>
<div class="grid2">
<div class="box"><h3>Sorumlulara göre</h3><div class="tw"><table><thead><tr><th>Sorumlu</th><th class="n">İl</th><th class="n">Açık iş</th><th class="n">Geciken</th><th class="n">Bu ay biten</th></tr></thead><tbody>
${per.map(p => `<tr><td><span class="cell"><span class="dot" style="background:var(${R[p.s]})"></span>${p.s}</span></td><td class="n">${p.il}</td><td class="n">${p.open}</td><td class="n">${p.late ? `<span class="badge late">! ${p.late}</span>` : '0'}</td><td class="n">${p.done}</td></tr>`).join('')}
</tbody></table></div></div>
<div class="box"><h3>Kişilere göre</h3><div class="tw"><table><thead><tr><th>Atanan</th><th class="n">Açık iş</th><th class="n">Geciken</th><th class="n">Bu ay biten</th></tr></thead><tbody>
${users.map(u => `<tr><td><span class="cell"><span class="av" style="margin:0">${esc(initials(u.n))}</span>${esc(u.n)}</span></td><td class="n">${u.open}</td><td class="n">${u.late ? `<span class="badge late">! ${u.late}</span>` : '0'}</td><td class="n">${u.done}</td></tr>`).join('')}
<tr><td class="stats">Kimseye atanmamış</td><td class="n">${unassigned}</td><td></td><td></td></tr>
</tbody></table></div></div>
<div class="box"><h3>En çok iş olan iller</h3>
${top.length ? `<div class="legend2"><span><i></i>Açık</span><span><i style="opacity:.35"></i>Tamamlanan</span><span>Renk: ilin sorumlusu</span></div><div class="bars" id="bars">
${top.map(([il, b]) => { const s = sorOf(il), col = s ? `var(${R[s]})` : 'var(--mut)'; return `<div class="bar" data-il="${esc(il)}" data-o="${b.open}" data-d="${b.done}" data-s="${esc(s || 'Atanmamış')}"><span class="name">${esc(il)}</span><span class="track">${b.open ? `<span class="seg open" style="width:${(b.open / max * 100).toFixed(1)}%;background:${col}"></span>` : ''}${b.done ? `<span class="seg done" style="width:${(b.done / max * 100).toFixed(1)}%;background:${col}"></span>` : ''}</span><span class="num">${b.open + b.done}</span></div>`; }).join('')}
</div>` : '<p class="stats">Henüz kart yok.</p>'}</div>
<div class="box"><h3>Geciken işler</h3>
${lateList.length ? `<div class="jobs" style="max-height:none">${lateList.map(c => `<button class="krow" data-id="${c.id}"><span class="t">${esc(c.baslik)} <span class="stats">· ${esc(c.il)}${c.atanan ? ' · ' + esc(uname(c.atanan)) : ''}</span></span><span class="badge late">! ${fmt(c.tarih)}</span></button>`).join('')}</div>${late.length > 8 ? `<p class="stats">ve ${late.length - 8} iş daha. Panoda "Sadece gecikenler" ile hepsini görebilirsiniz.</p>` : ''}` : '<p class="stats">Geciken iş yok.</p>'}
</div>
</div>`;
  v.querySelectorAll('.krow[data-id]').forEach(b => b.onclick = () => openCard(b.dataset.id));
  const tt = $('ttip');
  v.querySelectorAll('.bar').forEach(b => {
    b.onmousemove = e => { tt.hidden = false; tt.textContent = `${b.dataset.il} (${b.dataset.s}) · ${b.dataset.o} açık, ${b.dataset.d} tamamlanan`; tt.style.left = Math.min(e.clientX + 12, innerWidth - tt.offsetWidth - 8) + 'px'; tt.style.top = (e.clientY + 14) + 'px'; };
    b.onmouseleave = () => tt.hidden = true;
    b.onclick = () => { $('fIl').value = b.dataset.il; show('board'); };
    b.style.cursor = 'pointer';
  });
}

// ================= KULLANICILAR =================
$('bUsers').onclick = async () => { await loadUsers(); renderUsers(); $('uDlg').showModal(); };
$('uClose').onclick = () => $('uDlg').close();
function renderUsers() {
  const body = $('uBody'); body.innerHTML = ''; $('uErr').textContent = '';
  Object.entries(U).sort((a, b) => a[1].kullanici_adi.localeCompare(b[1].kullanici_adi, 'tr')).forEach(([id, u]) => {
    const tr = document.createElement('tr'); const self = id === ME.id;
    tr.innerHTML = `<td>${esc(u.kullanici_adi)}${self ? ' <span class="stats">(siz)</span>' : ''}</td>
<td><select ${self ? 'disabled title="Kendi rolünüzü değiştiremezsiniz"' : ''}>${ROLLER.map(([v, l]) => `<option value="${v}" ${u.rol === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
<td><select><option value="">—</option>${SORUMLULAR.map(s => `<option ${u.sorumlu_adi === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>`;
    const [rs, ss] = tr.querySelectorAll('select');
    const save = async () => {
      const { error } = await sb.from('izinli_kullanicilar').update({ rol: rs.value, sorumlu_adi: ss.value || null }).eq('user_id', id);
      if (error) { $('uErr').textContent = 'Kaydedilemedi: ' + error.message; return; }
      U[id] = { ...u, rol: rs.value, sorumlu_adi: ss.value || null }; toast(u.kullanici_adi + ' güncellendi');
    };
    rs.onchange = save; ss.onchange = save;
    body.appendChild(tr);
  });
}

// ================= EXCEL =================
let xlsxP = null;
const loadXlsx = () => xlsxP || (xlsxP = new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  s.onload = ok; s.onerror = () => { xlsxP = null; no(new Error('Excel kütüphanesi yüklenemedi')); }; document.head.appendChild(s);
}));
$('bExport').onclick = async () => {
  try { await loadXlsx(); } catch (e) { toast(e.message); return; }
  const cards = Object.values(K);
  const iller = ILLER.map(n => {
    const r = D[n] || {}, cs = cards.filter(c => c.il === n);
    return { 'İl': n, 'Sorumlu': r.s || '', 'Bayi': r.bayi || '', 'Yetkili': r.yetkili || '', 'Telefon': r.tel || '', 'Notlar': r.not || '', 'Açık iş': cs.filter(c => c.durum !== 'tamam').length, 'Geciken': cs.filter(isLate).length };
  });
  const ord = { yapilacak: 0, devam: 1, tamam: 2 };
  const isler = cards.sort((a, b) => a.il.localeCompare(b.il, 'tr') || ord[a.durum] - ord[b.durum]).map(c => ({
    'ID': c.id, 'İl': c.il, 'Sorumlu': sorOf(c.il), 'Başlık': c.baslik, 'Durum': DN[c.durum], 'Son tarih': fmt(c.tarih),
    'Gecikti': isLate(c) ? 'Evet' : '', 'Atanan': uname(c.atanan), 'Açıklama': c.aciklama || '', 'Oluşturulma': fmtTs(c.created_at), 'Tamamlanma': fmtTs(c.tamamlanma)
  }));
  const wb = XLSX.utils.book_new();
  const w1 = XLSX.utils.json_to_sheet(iller); w1['!cols'] = [14, 10, 24, 18, 15, 30, 8, 8].map(w => ({ wch: w }));
  const w2 = XLSX.utils.json_to_sheet(isler.length ? isler : [{ 'ID': '', 'İl': '', 'Sorumlu': '', 'Başlık': '', 'Durum': '', 'Son tarih': '', 'Gecikti': '', 'Atanan': '', 'Açıklama': '', 'Oluşturulma': '', 'Tamamlanma': '' }]);
  w2['!cols'] = [10, 14, 10, 34, 14, 11, 8, 12, 40, 16, 16].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, w1, 'İller'); XLSX.utils.book_append_sheet(wb, w2, 'İşler');
  XLSX.writeFile(wb, `Velamed-${today()}.xlsx`);
};
$('bImport').onclick = () => $('fImport').click();
let PLAN = null;
const cellStr = v => v == null ? '' : v instanceof Date ? v : String(v).trim();
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) { const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); }
  const m = String(v).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return String(v).slice(0, 10);
  return undefined;
}
function pick(row, ...names) { for (const k of Object.keys(row)) if (names.includes(norm(k))) return cellStr(row[k]); return ''; }
$('fImport').onchange = async () => {
  const f = $('fImport').files[0]; $('fImport').value = ''; if (!f) return;
  try { await loadXlsx(); } catch (e) { toast(e.message); return; }
  let wb; try { wb = XLSX.read(await f.arrayBuffer(), { cellDates: true }); } catch (e) { toast('Dosya okunamadı'); return; }
  const sheetBy = n => wb.SheetNames.find(s => norm(s) === n);
  const ilSheet = sheetBy('iller') || (wb.SheetNames.length === 1 ? wb.SheetNames[0] : null);
  const isSheet = sheetBy('isler');
  const errs = [], ilUp = [], isIns = [], isUpd = [];
  const userBy = Object.fromEntries(Object.entries(U).map(([id, u]) => [norm(u.kullanici_adi), id]));
  const durBy = { 'yapilacak': 'yapilacak', 'devam ediyor': 'devam', 'devam': 'devam', 'tamamlandi': 'tamam', 'tamam': 'tamam' };
  if (ilSheet) XLSX.utils.sheet_to_json(wb.Sheets[ilSheet], { defval: '' }).forEach((r, i) => {
    const raw = pick(r, 'il', 'sehir'); if (!raw) return;
    const il = ILN[norm(String(raw))]; if (!il) { errs.push(`İller satır ${i + 2}: "${raw}" bir il adı değil`); return; }
    const cur0 = D[il] || {}, s = pick(r, 'sorumlu');
    const sor = s ? SORUMLULAR.find(x => norm(x) === norm(s)) : cur0.s;
    if (s && !sor) errs.push(`İller satır ${i + 2}: sorumlu "${s}" tanınmadı, eski değer korunacak`);
    const val = (k, ...n) => { const v = pick(r, ...n); return v !== '' ? String(v) : (cur0[k] || null); };
    const row = { il, sorumlu: sor || cur0.s || null, bayi: val('bayi', 'bayi', 'bayi adi'), yetkili: val('yetkili', 'yetkili', 'yetkili kisi'), tel: val('tel', 'telefon', 'tel'), notlar: val('not', 'notlar', 'not') };
    const same = (row.sorumlu || '') === (cur0.s || '') && (row.bayi || '') === (cur0.bayi || '') && (row.yetkili || '') === (cur0.yetkili || '') && (row.tel || '') === (cur0.tel || '') && (row.notlar || '') === (cur0.not || '');
    if (same) return;
    const allowed = canAll() || (rol() === 'kendi' && sorOf(il) === ME.sorumlu_adi && row.sorumlu === ME.sorumlu_adi);
    if (!allowed) { errs.push(`${il}: düzenleme yetkiniz yok, atlandı`); return; }
    ilUp.push(row);
  });
  if (isSheet) XLSX.utils.sheet_to_json(wb.Sheets[isSheet], { defval: '' }).forEach((r, i) => {
    const b = pick(r, 'baslik', 'is', 'gorev'); if (!b) return;
    const ilRaw = pick(r, 'il'), il = ILN[norm(String(ilRaw))];
    if (!il) { errs.push(`İşler satır ${i + 2}: il "${ilRaw}" tanınmadı`); return; }
    if (!canEditIl(il)) { errs.push(`İşler satır ${i + 2}: ${il} için yetkiniz yok, atlandı`); return; }
    const dRaw = pick(r, 'durum'), durum = dRaw ? durBy[norm(String(dRaw))] : 'yapilacak';
    if (!durum) { errs.push(`İşler satır ${i + 2}: durum "${dRaw}" tanınmadı`); return; }
    const tRaw = pick(r, 'son tarih', 'tarih'), tarih = parseDate(tRaw);
    if (tarih === undefined) { errs.push(`İşler satır ${i + 2}: tarih "${tRaw}" okunamadı (gg.aa.yyyy yazın)`); return; }
    const aRaw = pick(r, 'atanan'), atanan = aRaw ? userBy[norm(String(aRaw))] : null;
    if (aRaw && !atanan) errs.push(`İşler satır ${i + 2}: atanan "${aRaw}" kullanıcı değil, boş bırakıldı`);
    const row = { il, baslik: String(b), durum, tarih, atanan: atanan || null, aciklama: String(pick(r, 'aciklama') || '') || null };
    const id = String(pick(r, 'id') || '');
    if (id && K[id]) {
      const c = K[id];
      if (c.il === row.il && c.baslik === row.baslik && c.durum === row.durum && (c.tarih || null) === row.tarih && (c.atanan || null) === row.atanan && (c.aciklama || null) === row.aciklama) return;
      isUpd.push({ id, row });
    } else isIns.push(row);
  });
  if (!ilSheet && !isSheet) { toast('Dosyada "İller" veya "İşler" sayfası bulunamadı'); return; }
  PLAN = { ilUp, isIns, isUpd };
  $('iSum').innerHTML = `<ul style="margin:0;padding-left:18px">
<li>${ilUp.length} ilin bilgisi güncellenecek</li><li>${isIns.length} yeni iş eklenecek</li><li>${isUpd.length} iş güncellenecek</li></ul>
${errs.length ? `<p class="stats" style="margin-bottom:0">Uyarılar (${errs.length}):</p><ul class="stats" style="margin:4px 0 0;padding-left:18px;max-height:160px;overflow:auto">${errs.slice(0, 50).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
<p class="stats">Boş hücreler mevcut bilgiyi silmez. ID sütunu dolu olan işler güncellenir, boş olanlar yeni iş olarak eklenir.</p>`;
  $('iErr').textContent = ''; $('iOk').disabled = !(ilUp.length + isIns.length + isUpd.length);
  $('iDlg').showModal();
};
$('iCancel').onclick = () => $('iDlg').close();
$('iOk').onclick = async () => {
  const { ilUp, isIns, isUpd } = PLAN; $('iOk').disabled = true; $('iErr').textContent = '';
  try {
    if (ilUp.length) { const { error } = await sb.from('iller').upsert(ilUp); if (error) throw error; ilUp.forEach(r => D[r.il] = { s: r.sorumlu || '', bayi: r.bayi, yetkili: r.yetkili, tel: r.tel, not: r.notlar }); }
    if (isIns.length) {
      let base = Date.now() / 1000;
      const rows = isIns.map(r => ({ ...r, sira: base++ }));
      const { data, error } = await sb.from('isler').insert(rows).select(); if (error) throw error; data.forEach(c => K[c.id] = c);
    }
    for (const { id, row } of isUpd) { const { data, error } = await sb.from('isler').update(row).eq('id', id).select().single(); if (error) throw error; K[id] = data; }
    $('iDlg').close(); refresh(); if (cur) sel(cur);
    toast(`Yüklendi: ${ilUp.length} il, ${isIns.length} yeni iş, ${isUpd.length} güncellenen iş`);
  } catch (e) { $('iErr').textContent = 'Yükleme yarıda kaldı: ' + e.message; $('iOk').disabled = false; }
};

// ================= VERİ & CANLI GÜNCELLEME =================
const fromIl = r => ({ s: r.sorumlu || '', bayi: r.bayi, yetkili: r.yetkili, tel: r.tel, not: r.notlar });
async function loadUsers() {
  const { data } = await sb.from('izinli_kullanicilar').select('user_id,kullanici_adi,rol,sorumlu_adi');
  U = {}; (data || []).forEach(u => U[u.user_id] = { kullanici_adi: u.kullanici_adi || '?', rol: u.rol, sorumlu_adi: u.sorumlu_adi });
  fillUserSelects();
}
async function loadAll() {
  const [il, is, yo, ek] = await Promise.all([
    sb.from('iller').select('*'),
    sb.from('isler').select('*'),
    sb.from('kart_olaylari').select('kart_id').eq('tur', 'yorum'),
    sb.from('ekler').select('*'),
  ]);
  if (il.error) { $('sync').textContent = 'Veri alınamadı: ' + il.error.message; return; }
  D = {}; il.data.forEach(x => D[x.il] = fromIl(x));
  K = {}; (is.data || []).forEach(c => K[c.id] = c);
  YC = {}; (yo.data || []).forEach(o => YC[o.kart_id] = (YC[o.kart_id] || 0) + 1);
  EK = {}; (ek.data || []).forEach(f => (EK[f.kart_id] = EK[f.kart_id] || []).push(f));
  $('sync').textContent = '· Canlı';
  refresh();
}
function subscribe() {
  sb.channel('velamed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'iller' }, p => {
      const x = p.new && p.new.il ? p.new : p.old;
      const editing = cur === x.il && $('side').contains(document.activeElement);
      if (p.eventType === 'DELETE') delete D[x.il]; else if (!editing) D[x.il] = fromIl(p.new);
      refresh(); if (cur === x.il && !editing) sel(cur);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'isler' }, p => {
      if (p.eventType === 'DELETE') { delete K[p.old.id]; if (editId === p.old.id) $('dlg').close(); }
      else K[p.new.id] = p.new;
      refresh();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kart_olaylari' }, p => {
      if (p.eventType === 'INSERT') {
        const o = p.new; if (o.tur === 'yorum' && !TL.some(z => z.id === o.id)) YC[o.kart_id] = (YC[o.kart_id] || 0) + 1;
        if (editId === o.kart_id && !TL.some(z => z.id === o.id)) { TL.unshift(o); renderTimeline(); }
        refresh();
      } else if (p.eventType === 'DELETE') { if (editId) loadTimeline(); loadAll(); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ekler' }, p => {
      if (p.eventType === 'INSERT') { const f = p.new; const l = (EK[f.kart_id] = EK[f.kart_id] || []); if (!l.some(z => z.id === f.id)) l.push(f); if (editId === f.kart_id) renderFiles(); }
      else if (p.eventType === 'DELETE') { Object.keys(EK).forEach(k => EK[k] = EK[k].filter(z => z.id !== p.old.id)); if (editId) renderFiles(); }
      refresh();
    })
    .subscribe();
}
// Gece yarısı geçince gecikmeleri yeniden hesapla
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); refresh(); } }, 60000);

// ================= GİRİŞ =================
async function start(sess) {
  if (!sess) { $('login').hidden = false; return; }
  $('login').hidden = true;
  await loadUsers();
  const u = U[sess.user.id];
  ME = { id: sess.user.id, kullanici_adi: u?.kullanici_adi || sess.user.email.replace(DOMAIN, ''), rol: u?.rol || 'izleyici', sorumlu_adi: u?.sorumlu_adi || null };
  $('me').textContent = ME.kullanici_adi + ' · ' + RN[ME.rol];
  $('bUsers').hidden = ME.rol !== 'yonetici';
  $('bImport').hidden = !canWriteAny();
  if (!u) $('sync').textContent = 'Hesabınıza henüz erişim izni verilmemiş. Yöneticiyle görüşün.';
  await loadAll(); subscribe();
  if (location.hash === '#pano') show('board'); else if (location.hash === '#ozet') show('sum');
}
$('toReg').onclick = () => { $('lf').hidden = true; $('rf').hidden = false; $('ru').focus(); };
$('toLog').onclick = () => { $('rf').hidden = true; $('lf').hidden = false; $('lu').focus(); };
$('rf').onsubmit = async e => {
  e.preventDefault(); $('rerr').textContent = '';
  if ($('rp').value !== $('rp2').value) { $('rerr').textContent = 'Şifreler aynı değil.'; return; }
  const { data, error } = await sb.rpc('kayit_ol', { kullanici: norm($('ru').value), sifre: $('rp').value, referans: $('rk').value.trim() });
  if (error) { $('rerr').textContent = error.message || 'Kayıt yapılamadı.'; return; }
  const r = await sb.auth.signInWithPassword({ email: data + DOMAIN, password: $('rp').value });
  if (r.error) { $('rerr').textContent = 'Kayıt tamam, ama giriş yapılamadı. Girişe dönüp tekrar deneyin.'; return; }
  $('rf').hidden = true; $('lf').hidden = false; start(r.data.session);
};
$('lf').onsubmit = async e => {
  e.preventDefault(); $('lerr').textContent = '';
  const u = norm($('lu').value);
  const { data, error } = await sb.auth.signInWithPassword({ email: u.includes('@') ? u : u + DOMAIN, password: $('lp').value });
  if (error) { $('lerr').textContent = 'Kullanıcı adı veya şifre hatalı.'; return; }
  start(data.session);
};
$('out').onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ================= UYGULAMA OLARAK YÜKLEME =================
let installEv = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; $('bInstall').hidden = false; });
$('bInstall').onclick = async () => { if (!installEv) return; installEv.prompt(); await installEv.userChoice; installEv = null; $('bInstall').hidden = true; };
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));

paint();
sb.auth.getSession().then(({ data }) => start(data.session));
