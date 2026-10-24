/* ==========================================================
   ADVANCE CLASH — ฐานข้อมูลการ์ด + ค่ากติกา (data-driven)
   แก้ไฟล์นี้เพื่อใส่ "การ์ดจริง" ของคุณ
   ฟิลด์ที่ engine ใช้: id name clan grade power move siege ward crit keywords text trigger
   keywords ที่รองรับ: blitz(บุกทันที) wall(กำแพง) tough(อึด) swift(คล่อง) fearless(เสรี)
   scavenge(เก็บกวาด) battery(เครื่องกำเนิด) rally(รวมพล) medic(พยาบาล) sniper(สไนเปอร์) break(ทะลุเกราะ)
   ========================================================== */

const RULES = {
  coreHP: 24,
  assaultBonus: 2,            //พลังบุก: ผู้โจมตีได้ +2
  coreGuard: 2,               //พลังกันของฐาน (หักจากดาเมจที่ทะลุเข้า)
  handMax: 6,
  forceBase: 2,                 //พลังขับต่อเทิร์น = forceBase + coreLevel
  forceCap: 14,
  coreLevelMax: 5,
  promoteCost: lv => 2 + lv,    //ค่าจ่าย (พลังขับ) เพื่อยกระดับฐาน
  deckSize: 24,
  maxCopies: 3,
  scarConvertMax: 2,            //แปลง damage ->พลังขับ ได้สูงสุดต่อเทิร์น
  boardRows: 6,                 //0 = แถวฐานศัตรู ... 5 = แถวฐานเรา
  boardCols: 5,
  ownRows: [3, 4],              //แถวที่ฝั่งเราลงการ์ดได้
  foeRows: [1, 2],              //แถวที่ฝั่งศัตรูลงการ์ดได้
  coreCol: 2,
};

const CLANS = {
  ember:   { name: 'เปลวราชวงศ์',    tone: '#ff8a3d' },
  tide:    { name: 'พันธะสายน้ำ',     tone: '#38d6d0' },
  verdant: { name: 'พงไพรนิรันดร์',   tone: '#7ddc5b' },
  void:    { name: 'สุญตาเรขาคณิต',  tone: '#a678ff' },
};

/* ---------------- การ์ด unit ---------------- */
const CARDS = [
  { id: 'e1', name: 'ทหารรักษาประทีป', clan: 'ember', grade: 0, power: 4, move: 2, siege: 2, ward: 1, crit: 0,
    text: 'หน่วยยิงบาง — ซัดข้ามแนวหน้าได้ถึง 2 ช่อง' },

  { id: 'e2', name: 'พลเบิดแนว', clan: 'ember', grade: 1, power: 6, move: 2, siege: 1, ward: 2, crit: 0, keywords: ['blitz'],
    text: 'blitz — โจมตีได้ทันทีที่ลงสนาม' },

  { id: 'e3', name: 'อัศวินเกราะไหม้', clan: 'ember', grade: 2, power: 7, move: 1, siege: 1, ward: 3, crit: 0, keywords: ['tough'],
    text: 'tough — แพ้การปะทะครั้งแรกยังไม่ตกจากกระดาน' },

  { id: 'e4', name: 'นายพันเพลิงบริสุทธิ์', clan: 'ember', grade: 2, power: 7, move: 2, siege: 1, ward: 2, crit: 1, keywords: ['wall'],
    text: 'wall — ศัตรูที่ประชิดต้องเล็งมันก่อน' },

  { id: 'e5', name: 'สิงห์คำรามทัพ', clan: 'ember', grade: 3, power: 9, move: 2, siege: 1, ward: 2, crit: 1, keywords: ['swift', 'break'],
    text: 'swift — เดินต่อได้หลังโจมตี' },

  { id: 'e6', name: 'เครื่องปฏิกรณ์สนาม', clan: 'ember', grade: 1, power: 3, move: 0, siege: 1, ward: 4, crit: 0, keywords: ['battery'],
    text: 'battery — +1 พลังขับ ทุกต้นเทิร์นของคุณ' },

  { id: 'e7', name: 'มือสังหารสุญตา', clan: 'void', grade: 2, power: 8, move: 2, siege: 3, ward: 2, crit: 2,
    keywords: ['sniper', 'fearless'],
    text: 'sniper / fearless — เล็งไกล 3 ช่อง และเลื่อนทะลุunit ศัตรูได้' },

  { id: 'e8', name: 'หมอทัพแนวหลัง', clan: 'verdant', grade: 1, power: 4, move: 1, siege: 1, ward: 2, crit: 0, keywords: ['medic'],
    text: 'medic — ปลายเทิร์น: ฐานของคุณฟื้น 1' },

  { id: 't1', name: 'สํารวจขอบน้ำ', clan: 'tide', grade: 0, power: 4, move: 3, siege: 1, ward: 1, crit: 0,
    text: 'เร็วที่สุดในสนาม — ใช้ยึดช่องกึ่งกลาง' },

  { id: 't2', name: 'หอกพันธะ', clan: 'tide', grade: 1, power: 5, move: 1, siege: 2, ward: 3, crit: 0,
    text: 'ยืนคุมเลน ซัดไกล 2 ช่อง' },

  { id: 't3', name: 'แนวปะการัง', clan: 'tide', grade: 2, power: 5, move: 0, siege: 1, ward: 5, crit: 0, keywords: ['wall', 'tough'],
    text: 'กำแพงมีชีวิต — บังทั้งเลน แต่เดินไม่ได้' },

  { id: 't4', name: 'แม่มดน้ำขึ้น', clan: 'tide', grade: 2, power: 7, move: 2, siege: 1, ward: 2, crit: 0, keywords: ['rally'],
    text: 'rally — unit ข้างเคียงของฝ่ายตน +1 พลัง' },

  { id: 't5', name: 'ราชินีเรืออับปาง', clan: 'tide', grade: 3, power: 9, move: 2, siege: 2, ward: 4, crit: 1, keywords: ['scavenge'],
    text: 'scavenge — เมื่อตก: +2 พลังขับ' },

  { id: 't6', name: 'ทุ่นสัญญาณลึก', clan: 'tide', grade: 1, power: 3, move: 0, siege: 3, ward: 3, crit: 0, keywords: ['battery'],
    text: 'battery — +1 พลังขับ/ต้นเทิร์น, ส่องไกล 3' },

  { id: 't7', name: 'พรานพงเวหา', clan: 'verdant', grade: 2, power: 8, move: 3, siege: 1, ward: 1, crit: 1,
    keywords: ['blitz', 'fearless'],
    text: 'blitz / fearless — ทะลวงแนวหลังทันที' },

  { id: 't8', name: 'ผู้ปลุกรากนิรันดร์', clan: 'verdant', grade: 3, power: 6, move: 1, siege: 1, ward: 5, crit: 0,
    keywords: ['medic', 'rally', 'tough'],
    text: 'medic / rally / tough — เสาหลักแนวหลัง' },
];

/* ---------------- การ์ดทริกเกอร์ (อยู่ในเด็ค) ---------------- */
const TRIGGERS = [
  { id: 'g_boost',  name: 'ทริกเกอร์: โบนัส',      trigger: 'boost',  power: 2, text: 'โจมตีครั้งนั้น +2 พลัง' },
  { id: 'g_crit',   name: 'ทริกเกอร์: คริติคอล', trigger: 'crit',   crit: 1, text: 'คริติคอล +1 เลเวล' },
  { id: 'g_draw',   name: 'ทริกเกอร์: จักรวาลเปิด', trigger: 'draw',   draw: 1, text: 'จั่ว 1 ใบ' },
  { id: 'g_charge', name: 'ทริกเกอร์: ประจุ',      trigger: 'charge', charge: 2, text: '+2 พลังขับ' },
];

/* ---------------- เด็คตัวอย่าง 2 ชุด (placeholder — แทนที่ด้วยการ์ดจริง) ---------------- */
const DECKS = {
  ember: {
    name: 'เปลวบุก',
    coreName: 'ฐานนครเพลิง',
    main: ['e2','e2','e3','e3','e4','e4','e5','e5','e1','e1','e6','e6','e7','e7','e8','t4',
           'g_boost','g_boost','g_crit','g_draw','g_charge','g_boost','g_crit','g_draw'],
  },
  tide: {
    name: 'สายน้ำยึดแนว',
    coreName: 'ฐานห้วงลึก',
    // เด็คทดสอบแบบ mirror กับชุดเปลวบุก (รายการการ์ดเหมือนกัน 100%)
    // เพื่อวัดค่าสมดุล "ฝ่ายเริ่มก่อน" ได้แม่น — พอได้การ์ดจริงของคุณ จะปรับให้คนละสไตล์
    main: ['e2','e2','e3','e3','e4','e4','e5','e5','e1','e1','e6','e6','e7','e7','e8','t4',
           'g_boost','g_boost','g_crit','g_draw','g_charge','g_boost','g_crit','g_draw'],
  },
};

const CARD_INDEX = {};
[...CARDS, ...TRIGGERS].forEach(c => { CARD_INDEX[c.id] = c; });
