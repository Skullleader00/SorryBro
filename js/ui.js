/* ==========================================================
   ADVANCE CLASH — UI layer (vanilla JS, ออกแบบให้แตะเล่นบนมือถือ)
   อ่าน engine ผ่าน global `Engine`, การ์ดผ่าน `CARDS/DECKS/RULES`
   ========================================================== */
(function () {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const board = $('board');
  const KEYTAG = {
    blitz: 'บุกทันที', wall: 'กำแพง', tough: 'อึด', swift: 'คล่อง', fearless: 'เสรี',
    scavenge: 'เก็บกวาด', battery: 'เครื่องกำเนิด', rally: 'รวมพล', medic: 'พยาบาล', sniper: 'สไนเปอร์', break: 'ทะลุเกราะ'
  };
  const UI = { S: null, sel: null, hl: { deploy: new Set(), move: new Set(), atk: new Set(), core: false }, busy: false, logAt: 0, guardResolve: null };
  const human = 'p0', aiSide = 'p1';
  const cd = id => CARD_INDEX[id];

  /* ---------------- board skeleton ---------------- */
  function buildBoard() {
    board.innerHTML = '';
    for (let r = 0; r < RULES.boardRows; r++) {
      for (let c = 0; c < RULES.boardCols; c++) {
        const isCoreRow = (r === 0 || r === RULES.boardRows - 1);
        const cell = el('div', 'cell' + (isCoreRow ? (c === RULES.coreCol ? ' corecell' : ' void') : (RULES.foeRows.includes(r) ? ' foezone' : ' ownzone')));
        cell.dataset.r = r; cell.dataset.c = c;
        cell.appendChild(el('span', 'coord', Engine.cellName(r, c)));
        cell.appendChild(el('div', 'token'));
        cell.addEventListener('click', () => onCell(r, c));
        board.appendChild(cell);
      }
    }
  }

  /* ---------------- render ---------------- */
  function render() {
    const S = UI.S; if (!S) return;
    const p = S.players[human], q = S.players[aiSide];
    $('turnChip').textContent = `เทิร์น ${S.turn} · ${S.active === human ? 'ตาคุณ' : 'ตา AI'}`;
    $('turnChip').classList.toggle('mine', S.active === human);
    $('foeDeck').textContent = q.deckName; $('foeCoreHP').textContent = q.coreHP; $('foeCoreLv').textContent = q.coreLevel;
    $('foeForce').textContent = q.force; $('foeDeckN').textContent = q.deck.length; $('foeDamageN').textContent = q.damage.length;
    $('foeHandN').textContent = q.hand.length;
    $('foeHpFill').style.width = (100 * q.coreHP / RULES.coreHP) + '%';
    $('ownDeck').textContent = p.deckName; $('ownCoreHP').textContent = p.coreHP; $('ownCoreLv').textContent = p.coreLevel;
    $('ownForce').textContent = p.force; $('ownDeckN').textContent = p.deck.length; $('ownDropN').textContent = p.drop.length;
    $('ownHpFill').style.width = (100 * p.coreHP / RULES.coreHP) + '%';
    $('handCount').textContent = `${p.hand.length}/${RULES.handMax}`;

    // cells
    [...board.children].forEach(cell => {
      const r = +cell.dataset.r, c = +cell.dataset.c, tok = cell.querySelector('.token');
      cell.classList.remove('hl-deploy', 'hl-move', 'hl-atk', 'hl-sel', 'flash');
      const kk = Engine.key(r, c);
      if (UI.hl.deploy.has(kk)) cell.classList.add('hl-deploy');
      if (UI.hl.move.has(kk)) cell.classList.add('hl-move');
      const isCoreRow = (r === 0 || r === RULES.boardRows - 1);
      tok.innerHTML = '';
      if (isCoreRow) {
        if (c === RULES.coreCol) {
          const owner = r === 0 ? aiSide : human;
          const pl = S.players[owner];
          tok.className = 'token core-token ' + (owner === human ? 'own' : 'foe');
          tok.innerHTML = `<b>${pl.coreHP}</b><i>${pl.coreName}</i><span>Lv.${pl.coreLevel}</span>`;
          if (UI.hl.core) cell.classList.add('hl-atk');
        } else { tok.className = 'token'; }
        return;
      }
      const u = Engine.at(S, r, c);
      if (!u) { tok.className = 'token'; return; }
      const ch = cd(u.cardId);
      const left = Math.max(0, (ch.move || 0) - u.moved);
      tok.className = 'token unit ' + (u.side === human ? 'own' : 'foe')
        + ((u.attacked || (u.deployed && !(ch.keywords || []).includes('blitz'))) ? ' spent' : '')
        + (UI.sel && UI.sel.kind === 'unit' && UI.sel.uid === u.uid ? ' sel' : '');
      tok.innerHTML = `<span class="u-name">${ch.name}</span>
        <b class="u-pwr">${Engine.effPower(S, u)}</b>
        <span class="u-badges">
          ${left ? `<i class="b-move">↝${left}</i>` : ''}
          <i class="b-siege">⌖${ch.siege || 1}</i>
          ${u.tough ? `<i class="b-tough">◈${u.tough}</i>` : ''}
          ${u.shaken ? `<i class="b-shake">✱</i>` : ''}
        </span>`;
      if (UI.hl.atk.has('u:' + u.uid)) cell.classList.add('hl-atk');
    });

    // hand
    const hand = $('hand'); hand.innerHTML = '';
    p.hand.forEach((id, i) => {
      const ch = cd(id);
      const afford = ch.grade <= p.force && S.active === human && !UI.busy && !S.pending;
      const c = el('button', 'gcard clan-' + ch.clan + (UI.sel && UI.sel.kind === 'hand' && UI.sel.idx === i ? ' sel' : '') + (afford ? '' : ' dim'));
      c.innerHTML = `<span class="gc-grade">${ch.grade ?? 'T'}</span>
        <span class="gc-name">${ch.name}</span>
        <span class="gc-stats"><b>${ch.power ?? '—'}</b><i>พลัง</i><b>${ch.move ?? '—'}</b><i>เดิน</i><b>${ch.siege ?? '—'}</b><i>ยิง</i><b>${ch.ward ?? '—'}</b><i>กัน</i></span>
        <span class="gc-kw">${(ch.keywords || []).map(k => `<em>${KEYTAG[k] || k}</em>`).join('')}</span>
        <span class="gc-text">${ch.text}</span>`;
      c.addEventListener('click', e => { e.stopPropagation(); onHand(i); });
      hand.appendChild(c);
    });

    $('btnPromote').disabled = !(S.active === human && !UI.busy && !S.pending) || p.promotedThisTurn || p.coreLevel >= RULES.coreLevelMax || p.force < RULES.promoteCost(p.coreLevel);
    $('btnScar').disabled = !(S.active === human && !UI.busy && !S.pending) || !p.damage.length || p.convertedThisTurn >= RULES.scarConvertMax;
    $('btnCancel').disabled = !UI.sel && !S.pending;

    // log
    const lb = $('logBody');
    while (UI.logAt < S.log.length) {
      const L = S.log[UI.logAt++];
      const row = el('div', 'lg ' + L.kind + (L.p && L.p !== human ? ' foe' : ''), `<span>${L.t}</span> ${L.msg}`);
      lb.appendChild(row);
    }
    if (lb.children.length > 400) lb.removeChild(lb.firstChild);
    lb.scrollTop = lb.scrollHeight;
    renderGuard();
  }

  function clearHL() { UI.hl.deploy.clear(); UI.hl.move.clear(); UI.hl.atk.clear(); UI.hl.core = false; }

  function selectUnit(u) {
    UI.sel = { kind: 'unit', uid: u.uid };
    clearHL();
    Engine.legalMoves(UI.S, u).forEach(k => UI.hl.move.add(k));
    Engine.legalAttacks(UI.S, u).forEach(t => t === 'c' ? UI.hl.core = true : UI.hl.atk.add(t));
    hint(uiHint(u));
  }
  function selectHand(i) {
    UI.sel = { kind: 'hand', idx: i };
    clearHL();
    Engine.legalDeploy(UI.S, human, i).forEach(k => UI.hl.deploy.add(k));
    hint(UI.hl.deploy.size ? 'แตะช่อง-highlight เพื่อวางunit' : 'ยังว่างไม่ได้ — ช่องเต็มหรือพลังขับไม่พอ');
  }
  function deselect() { UI.sel = null; clearHL(); hint(defaultHint()); }
  const defaultHint = () => UI.S && UI.S.active !== human ? 'AI กำลังเดิน...' : 'แตะการ์ดในมือเพื่อลงสนาม · แตะunit ของคุณเพื่อเดินหรือโจมตี';
  const hint = t => $('hint').textContent = t;
  function uiHint(u) {
    const ch = cd(u.cardId);
    const a = Engine.legalAttacks(UI.S, u);
    return `[${ch.name}] เดินเหลือ ${Math.max(0, (ch.move || 0) - u.moved)} · เป้าที่ตีได้ ${a.length ? a.map(x => x === 'c' ? 'ฐานศัตรู' : cd(UI.S.units[x.slice(2)].cardId).name).join(', ') : 'ไม่มี (ต้องเดินเข้าระยะยิง)'}`;
  }

  /* ---------------- input ---------------- */
  function onHand(i) {
    const S = UI.S;
    if (S.active !== human || UI.busy || S.pending) return;
    if (UI.sel && UI.sel.kind === 'hand' && UI.sel.idx === i) return deselect();
    selectHand(i); render();
  }

  async function onCell(r, c) {
    const S = UI.S;
    if (S.active !== human || UI.busy || S.pending) return;
    const cell = board.children[r * RULES.boardCols + c];
    cell.classList.add('flash');
    const u = Engine.at(S, r, c);
    if (UI.sel && UI.sel.kind === 'hand') {
      const res = Engine.deploy(S, human, UI.sel.idx, Engine.key(r, c));
      if (!res.ok) return hint(res.why);
      deselect(); render(); return;
    }
    if (UI.sel && UI.sel.kind === 'unit') {
      const attacker = S.units[UI.sel.uid];
      if (!attacker) return deselect(), render();
      if (u && u.side !== human && UI.hl.atk.has('u:' + u.uid)) {
        const res = Engine.declareAttack(S, attacker.uid, u.uid);
        deselect(); render();
        if (res.ok && S.pending) renderGuard();
        return;
      }
      if (UI.hl.core && r === 0 && c === RULES.coreCol) {
        Engine.declareAttack(S, attacker.uid, 'core');
        deselect(); render(); maybeWin(); return;
      }
      if (UI.hl.move.has(Engine.key(r, c))) {
        const res = Engine.moveTo(S, attacker.uid, Engine.key(r, c));
        if (!res.ok) return hint(res.why);
        selectUnit(S.units[attacker.uid]); render(); return;
      }
    }
    if (u && u.side === human) { selectUnit(u); render(); return; }
    deselect(); render();
  }

  /* ---------------- guard prompt ---------------- */
  function renderGuard() {
    const S = UI.S, bar = $('guardBar'), box = $('guardOpts');
    if (!S.pending || S.pending.defender !== human) { bar.classList.add('hidden'); $('guardVeil').classList.add('hidden'); return; }
    const att = S.units[S.pending.attacker];
    const tgt = S.pending.target === 'core' ? null : S.units[S.pending.target];
    bar.classList.remove('hidden');
    const incoming = Engine.strikePower(S, att, tgt);
    const mine = tgt ? Engine.effPower(S, tgt) : 0;
    box.innerHTML = ''; bar.classList.remove('hidden'); $('guardVeil').classList.remove('hidden');
    const info = el('div', 'guard-info', tgt
      ? `${cd(att.cardId).name} <b class="dmg">${incoming}</b> → [${cd(tgt.cardId).name}] <b>${mine}</b> (กันได้สูงสุด +${(S.pending.opts.length - 1) * 2})`
      : `${cd(att.cardId).name} <b class="dmg">${incoming}</b> → <b>ฐานของคุณ</b> (หักพลังกันฐาน ${RULES.coreGuard})`);
    box.appendChild(info);
    S.pending.opts.forEach(k => {
      const b = el('button', 'guard-opt' + (k === 0 ? ' pass' : ''), k === 0 ? 'ไม่กัน' : `จ่าย ${k} → +${k * 2}`);
      b.disabled = S.players[human].force < k;
      b.addEventListener('click', () => { Engine.resolveAttack(S, k); bar.classList.add('hidden'); if (UI.guardResolve) { const r = UI.guardResolve; UI.guardResolve = null; r(); } render(); maybeWin(); });
      box.appendChild(b);
    });
  }

  /* ---------------- turn flow ---------------- */
  async function aiPhase() {
    const S = UI.S;
    UI.busy = true; deselect(); render(); hint('AI กำลังวางแผน…');
    await sleep(360);
    Engine.aiSetup(S); render(); await sleep(280);
    let g = 0;
    while (!S.winner && g++ < 160) {
      const r = Engine.aiStep(S); render();
      if (r.paused) { await new Promise(res => { UI.guardResolve = res; }); continue; }
      if (r.done) break;
      if (r.acted) await sleep(r.kind === 'attack' ? 620 : 330);
    }
    if (!S.pending) { UI.busy = false; Engine.aiFinish(S); deselect(); render(); hint('ตาคุณ — ลงการ์ด / เดิน / โจมตี'); maybeWin(); }
  }

  function humanEndTurn() {
    const S = UI.S;
    if (S.active !== human || UI.busy || S.pending) return;
    deselect(); Engine.endTurn(S); render();
    if (S.winner) return maybeWin();
    aiPhase();
  }

  function maybeWin() {
    const S = UI.S; if (!S.winner) return;
    const win = S.winner === human;
    const tally = JSON.parse(localStorage.getItem('ac_tally') || '{"w":0,"l":0}');
    tally[win ? 'w' : 'l']++; localStorage.setItem('ac_tally', JSON.stringify(tally));
    $('overTitle').textContent = win ? 'ชนะ — ฐานศัตรูแตก' : 'ฐานของคุณแตก';
    $('overTitle').className = win ? 'win' : 'lose';
    const last = S.log.slice().reverse().find(l => /ทะลุฐาน|หมดสมุด|ล้มลง/.test(l.msg));
    $('overDetail').innerHTML = `ใช้เวลา ${S.turn} เทิร์น · ฐานคุณ ${S.players[human].coreHP}/${RULES.coreHP} · ฐานศัตรู ${S.players[aiSide].coreHP}/${RULES.coreHP}<br>${last ? last.msg : ''}`;
    openModal('modalOver');
  }

  /* ---------------- rules / cards modal ---------------- */
  const RULEBOOK = () => `
  <h2>กติกา — ADVANCE CLASH <small>rulebook v0.1</small></h2>
  <div class="rb">
    <section><h3>สนาม 6×5</h3>
    <p>แถวบนสุด (1) = ฐานศัตรู, แถวล่างสุด (6) = ฐานคุณ — สองแถวนี้<b>ห้ามunit วางตัว</b>
    เขตคุณลงได้เฉพาะแถว 4–5, เขตศัตรูลงได้แถว 2–3 การ<b>เดินข้ามช่อง</b>คือแกนหลักของเกม</p></section>

    <section><h3>ลำดับเทิร์น</h3>
    <p>ต้นเทิร์น: จั่ว 1, ได้พลังขับ = ${RULES.forceBase} + เลเวลฐาน (+1 ต่อ 'เครื่องกำเนิด' ที่ยืนอยู่) →
    ทำ actions อิสระ (ลงการ์ด / เดิน / ยกระดับ / แปลงรอยแผล / โจมตี) → จบเทิร์น</p></section>

    <section><h3>พลังขับ (Force)</h3>
    <p>ใช้ลงการ์ด (จ่าย = เกรด) · ยกระดับฐาน (จ่าย ${RULES.promoteCost(1)} แล้วบวกตามเลเวล) · ป้องกัน (guard)
    เก็บสูงสุด ${RULES.forceCap} <b>โบนัส: เดินหน้าเข้าเขตศัตรู 1 ช่อง = +1 พลังขับ</b></p></section>

    <section><h3>การเคลื่อนที่</h3>
    <p>unit เดินได้ไม่เกินค่า <b>เดิน</b> ช่อง (ขึ้น/ลง/ซ้าย/ขวา) ต่อเทิร์น — เดินผ่านหรือข้ามunit ศัตรูได้เฉพาะ keyword <b>เสรี (fearless)</b>
    <br><b> สนามกด (binding)</b>: ถ้ามีunit ศัตรูอยู่ข้างเคียง คุณ<b>ถอยหนีไม่ได้</b> — ต้องโจมตีหรือขยับแบบประชิดต่อไป (fearless เป็นข้อยกเว้น)
    <br>เดินแล้วโจมตีได้ · โจมตีแล้วจบ action (ยกเว้น <b>คล่อง / swift</b>) · ลงสนามเทิร์นนี้โจมตีไม่ได้ (ยกเว้น <b>บุกทันที / blitz</b>)</p></section>

    <section><h3>การโจมตี (Clash)</h3>
    <p>เลือกเป้าหมายในระยะค่า <b>ยิง</b> (นับแบบ Manhattan) หรือ<b>ฐานศัตรู</b>ถ้าอยู่ในระยะ
    <br>ฝ่ายโจมตี: พลัง + <b>${RULES.assaultBonus} (พลังบุก)</b> + ขนาบเป้าหมาย +1 ต่อunit (สูงสุด +2) + โบนัส drive trigger
    <br>ฝ่ายรับ: พลัง + พลังกัน (guard ที่จ่าย: 1 พลังขับ = +2 พลังกัน)
    <br>ถ้ามากกว่า → ฝ่ายรับ<b>ล้มลง</b> (ตกสู่ trash) | ถ้าเท่าหรือน้อยกว่า → การโจมตีล่ม แต่ผู้รับเกิด<b>“เซ”</b> (-2 พลัง และกันไม่ได้ในเทิร์นหน้า)
    <br>ถ้ามีunit ศัตรูที่มี keyword <b>กำแพง (wall)</b> ประชิดอยู่ <b>ต้องตีมันก่อน</b> (sniper เลี่ยงข้อนี้ได้)</p></section>

    <section><h3>Drive check & ทริกเกอร์</h3>
    <p>ทุกการโจมตี: <b>สุ่มเปิด 1 ใบจากสมุด</b> ใส่ <b>Damage Zone</b> — ถ้าเป็นการ์ดทริกเกอร์จะได้ผลทันที
    (โบนัส +2 พลัง / คริติคอล +1 / จั่ว 1 / +2 พลังขับ)</p></section>

    <section><h3>คริติคอล</h3><p>ทอย 1d6 ถ้า ≥ 7 − (ค่าคริติคอลรวม) = คริติคอล → ดาเมจใส่<b>ฐานเป็น 2 เท่า</b></p></section>

    <section><h3>ฐาน (Core)</h3>
    <p>HP เริ่ม ${RULES.coreHP} · พลังกันฐาน ${RULES.coreGuard} · ยกระดับได้เทิร์นละ 1 ครั้ง (เลเวลสูงสุด ${RULES.coreLevelMax})
    แต่ละเลเวล = +1 พลังขับ/เทิร์น และฟื้นฐาน 2 · ฟื้นได้ไม่เกินค่าเริ่มต้น (keyword พยาบาล +1 ตอนปลายเทิร์น)</p></section>

    <section><h3>รอยแผล = ทรัพยากรโต้กลับ</h3>
    <p>การ์ดใน Damage Zone แปลงเป็นพลังขับได้สูงสุด ${RULES.scarConvertMax} ใบ/เทิร์น (ใบที่แปลงแล้วลง trash)</p></section>

    <section><h3>แพ้–ชนะ</h3>
    <p>ลด HP ฐานศัตรูถึง 0 หรือทำให้ฝ่ายตรงข้ามจั่วไม่เหลือทั้งสมุดและมือ</p></section>

    <section><h3>รายชื่อ keyword ทั้งหมด</h3>
    <p class="kws">${Object.keys(KEYTAG).map(k => `<em>${KEYTAG[k]} = ${k}</em>`).join(' · ')}</p></section>
  </div>`;

  const CATALOG = () => `
  <h2>ฐานข้อมูลการ์ด <small>${CARDS.length + TRIGGERS.length} ใบ · แก้ที่ js/data.js</small></h2>
  <div class="cat">${CARDS.map(c => `<div class="cat-card clan-${c.clan}">
      <span class="gc-grade">${c.grade}</span><b>${c.name}</b>
      <span class="cat-st">พลัง ${c.power} · เดิน ${c.move} · ยิง ${c.siege} · กัน ${c.ward} · คริต ${c.crit}</span>
      <span class="gc-kw">${(c.keywords || []).map(k => `<em>${KEYTAG[k] || k}</em>`).join('')}</span>
      <span class="cat-tx">${c.text}</span></div>`).join('')}
    ${TRIGGERS.map(t => `<div class="cat-card trig"><b>${t.name}</b><span class="cat-tx">${t.text}</span></div>`).join('')}
  </div>`;

  const IMPORTDOC = () => `
  <h2>ใส่การ์ดของคุณเอง <small>2 วิธี</small></h2>
  <div class="rb">
    <section><h3>A — ส่งรูปการ์ดมาให้ผม</h3>
    <p>แนบรูปการ์ด (ถ่าย/สแกน) มาในแชท → ผมจะ OCR อ่านชื่อ–ค่าสถานะ–คำอธิบายeffect แปลงเป็น entry ใน <code>js/data.js</code>
    แล้วผูกภาพจริงเข้าการ์ด (สนาม มือ log ทั้งหมดจะอ่านจาก data ไฟล์เดียว)</p></section>
    <section><h3>B — แก้ js/data.js ตรง ๆ</h3>
    <pre>const CARDS = [
  { id:'my1', name:'การ์ดของคุณ', clan:'ember',
    grade:2,      // = ค่าพลังขับในการลง
    power:9,      // พลังต่อสู้
    move:2,       // ช่องที่เดินได้/เทิร์น
    siege:1,      // ระยะยิง (Manhattan)
    ward:3,       // سقف พลังกัน (guard)
    crit:1,       // เลเวลคริติคอล
    keywords:['tough','wall'],
    text:'อธิบายeffect ของการ์ด',
    art:'img/my1.jpg'   // ทางเลือก: ระบุไฟล์รูปในโฟลเดอร์ img/
  }, ...
];
// เด็ค: เปลี่ยนรายการ id ใน DECKS.*.main (24 ใบ, ซ้ำได้สูงสุด ${RULES.maxCopies} ใบ)</pre>
    <p>ค่าคงที่กติกาทั้งหมดอยู่ใน <code>RULES</code> (HP ฐาน, พลังบุก, ระยะสนาม) — แก้แล้วเกมและหน้ากติกาจะอัปเดตตามทันที</p></section>
    <section><h3>rulebook ใหม่</h3><p>พอคุณอัปเดตรulebook ผมจะเพิ่ม keyword / กลไกใหม่เข้า engine ตามกติกาใหม่ — โครงปัจจุบันรองรับการเพิ่มด้วยตาราง keyword กลางไฟล์เดียว</p></section>
  </div>`;

  /* ---------------- modal plumbing ---------------- */
  function openModal(id) {
    $('veil').classList.remove('hidden');
    $('btnModalX').style.display = (id === 'modalHome' && !UI.S) ? 'none' : 'grid';
    ['modalHome', 'modalRules', 'modalOver'].forEach(m => $(m).classList.toggle('hidden', m !== id));
    if (id === 'modalOver') $('logDrawer').classList.remove('open');
  }
  const closeModal = () => $('veil').classList.add('hidden');

  function newGame() {
    const opts = {
      p0deck: $('selOwnDeck').value, p1deck: $('selFoeDeck').value,
      p1GoesFirst: $('selFirst').value === 'p1', humanSide: human,
    };
    UI.S = Engine.init(opts);
    UI.logAt = 0; $('logBody').innerHTML = '';
    UI.busy = false; deselect();
    $('seedTag').textContent = UI.S.seed;
    closeModal(); render();
    if (UI.S.active !== human) aiPhase(); else hint('ตาคุณ — ลงการ์ด / เดิน / โจมตี');
  }

  /* ---------------- boot ---------------- */
  function boot() {
    buildBoard();
    const mk = (sel, def) => { sel.innerHTML = ''; Object.keys(DECKS).forEach(k => sel.appendChild(new Option(DECKS[k].name, k))); sel.value = def; };
    mk($('selOwnDeck'), 'ember'); mk($('selFoeDeck'), 'tide');
    const t = JSON.parse(localStorage.getItem('ac_tally') || '{"w":0,"l":0}');
    $('btnStart').textContent = `เข้าสนามแข่ง  (${t.w}ช / ${t.l}แพ)`;
    $('btnModalX').onclick = () => { if (UI.S) { closeModal(); } else { openModal('modalHome'); } };
    $('veil').addEventListener('click', e => { if (e.target === $('veil') && UI.S) closeModal(); });
    $('btnRules').onclick = $('btnRules2').onclick = () => { $('modalRules').innerHTML = RULEBOOK() + CATALOG(); openModal('modalRules'); };
    $('btnImport').onclick = () => { $('modalRules').innerHTML = IMPORTDOC(); openModal('modalRules'); };
    $('btnLog').onclick = () => $('logDrawer').classList.toggle('open');
    $('btnLogClose').onclick = () => $('logDrawer').classList.remove('open');
    $('btnMenu').onclick = () => { if (!UI.S) return; const t2 = JSON.parse(localStorage.getItem('ac_tally') || '{"w":0,"l":0}'); $('btnStart').textContent = `เข้าสนามแข่ง  (${t2.w}ช / ${t2.l}แพ)`; openModal('modalHome'); };
    $('btnStart').onclick = newGame;
    $('btnAgain').onclick = newGame;
    $('btnOverLog').onclick = () => { closeModal(); $('logDrawer').classList.add('open'); };
    $('btnPromote').onclick = () => { const r = Engine.promote(UI.S, human); if (!r.ok) hint(r.why); render(); };
    $('btnScar').onclick = () => { const r = Engine.convertScar(UI.S, human, 1); if (!r.ok) hint(r.why); render(); };
    $('btnCancel').onclick = () => { if (UI.S.pending) return; deselect(); render(); };
    const endBtn = el('button', 'end-turn', 'จบเทิร์น ▸');
    endBtn.id = 'btnEnd';
    endBtn.onclick = humanEndTurn;
    $('plateOwn').appendChild(endBtn);
    $('modalHome').addEventListener('click', e => e.stopPropagation());
    hint(defaultHint());
    openModal('modalHome');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (UI.S && UI.S.pending) return; deselect(); render(); }
    if (e.key === ' ' || e.key === 'Enter') { if (UI.S && $('veil').classList.contains('hidden')) { e.preventDefault(); humanEndTurn(); } }
  });
  boot();
})();
