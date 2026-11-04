// HomePro Field: one form for a stairlift lead or a signed deal.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, "")); return isNaN(n) ? 0 : n; };
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
let token = store.get("hp.token");
let CFG = null;
const DRAFT = "hp.draft";

function toast(msg, ms = 2800) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms); }
async function api(path, body, raw = false) {
  const res = await fetch("/api" + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && path !== "/login") { logout(); throw new Error("Please log in again"); }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({ error: "Unexpected server response" }));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}
function logout() { token = null; store.del("hp.token"); $("#who").hidden = true; login(); }
$("#who").onclick = () => { if (confirm("Log out?")) logout(); };
$("#back").onclick = () => form();

// ---------- widgets ----------
function signaturePad(el) {
  const canvas = el.querySelector("canvas"), ctx = canvas.getContext("2d");
  let drawing = false, dirty = false, last = null;
  const size = () => {
    const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#13204a"; dirty = false;
  };
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener("pointerdown", (e) => { drawing = true; last = pt(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener("pointermove", (e) => { if (!drawing) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; dirty = true; });
  canvas.addEventListener("pointerup", () => (drawing = false)); canvas.addEventListener("pointercancel", () => (drawing = false));
  el.querySelector(".clear").onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; };
  requestAnimationFrame(size);
  return { isEmpty: () => !dirty, toDataURL: () => (dirty ? canvas.toDataURL("image/png") : null) };
}
const sigHTML = (id) => `<div class="sigwrap" id="${id}"><canvas></canvas><div class="sigline"></div><span class="x">×</span><button type="button" class="clear">Clear</button></div>`;
async function compress(file, max = 1600, q = 0.78) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
  } finally { URL.revokeObjectURL(url); }
}

// ---------- login ----------
function login() {
  $("#back").hidden = true;
  app.innerHTML = `<h1>HomePro Field</h1><p class="lead">Enter your PIN.</p><div class="pin" id="dots"></div><div class="keys" id="keys"></div>`;
  let pin = "";
  const dots = () => { $("#dots").innerHTML = Array.from({ length: 6 }, (_, i) => `<i class="${i < pin.length ? "f" : ""}"></i>`).join(""); };
  dots();
  $("#keys").innerHTML = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k) => `<button type="button" ${k ? "" : "style='visibility:hidden'"} data-k="${k}">${k}</button>`).join("");
  $("#keys").onclick = async (e) => {
    const k = e.target.dataset?.k; if (!k) return;
    pin = k === "⌫" ? pin.slice(0, -1) : (pin + k).slice(0, 6); dots();
    if (pin.length === 6) {
      try { const r = await api("/login", { pin }); token = r.token; store.set("hp.token", token); form(); }
      catch (err) { toast(err.message); pin = ""; dots(); }
    }
  };
}

// ---------- draft ----------
const blankFlight = () => ({ steps: "", width: "", length: "", side: "", turn: "" });
function newDraft() {
  return {
    jobNumber: "", date: CFG.today, installDate: "TBD", customer: { first: "", last: "", address: "", city: "", state: "SC", zip: "", phone: "", alt: "", email: "" },
    customer2: null, contactId: null, heightWeight: "", lifts: [], vpl: "", vplFeatures: {}, extras: {}, grabBars: [],
    stopOnLastStep: false, additionalItems: "", notes: "", leadNotes: "", price: "", deposit: "", payType: "Cash",
    photos: [], idPhoto: null,
  };
}
let D = null;
const save = () => store.set(DRAFT, D);

// ---------- main form ----------
async function form() {
  $("#who").hidden = false; $("#back").hidden = true;
  if (!CFG) { app.innerHTML = `<div class="empty"><span class="spinner"></span></div>`; try { CFG = await api("/config"); } catch (e) { app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; } }
  D = store.get(DRAFT) || newDraft();
  render();
}

function liftHTML(l, i) {
  const kind = CFG.products[l.product]?.kind || l.kind;
  const models = Object.entries(CFG.products).filter(([, p]) => p.kind === kind);
  const fl = l.flights.map((f, j) => `<div class="flight" data-l="${i}" data-f="${j}">
      ${l.flights.length > 1 ? `<h3>Flight ${j + 1}</h3>` : ""}
      <div class="row4">
        <div><label>Steps</label><input data-ff="steps" inputmode="numeric" value="${esc(f.steps)}"></div>
        <div><label>Width (in)</label><input data-ff="width" inputmode="decimal" value="${esc(f.width)}"></div>
        <div><label>Length (in)</label><input data-ff="length" inputmode="decimal" value="${esc(f.length)}"></div>
      </div>
      <label>Lift installed on (looking up)</label>
      <div class="seg" data-seg="side"><button data-v="L">Left</button><button data-v="R">Right</button></div>
      ${kind === "curved" && j < l.flights.length - 1 ? `<label>At the top of this flight the stairs turn</label><div class="seg" data-seg="turn"><button data-v="L">Left</button><button data-v="R">Right</button></div>` : ""}
      ${kind === "curved" && j === 2 ? `<button class="linkbtn danger" data-rmflight>Remove third flight</button>` : ""}
    </div>`).join("");
  return `<div class="card lift" data-l="${i}">
    <div class="split"><b>Lift ${i + 1} · ${kind === "curved" ? "Curved" : "Straight"}</b><button class="linkbtn danger" data-rmlift>Remove</button></div>
    <label>Model</label><select data-model>${models.map(([k, p]) => `<option value="${k}" ${k === l.product ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
    ${fl}
    ${kind === "curved" && l.flights.length < 3 ? `<button class="linkbtn" data-addflight>+ Add third flight</button>` : ""}
    <label>Outlet location <span class="opt">(required)</span></label><input data-outlet value="${esc(l.outlet || "")}" placeholder="e.g. bottom of stairs, left wall">
  </div>`;
}

function render() {
  const c = D.customer, ex = D.extras;
  app.innerHTML = `<h1>New job</h1>
  <h2>Customer</h2><div class="card">
    <label for="find">Find in GoHighLevel <span class="opt">(optional)</span></label><input id="find" type="search" placeholder="Name, phone or email" autocomplete="off"><div class="picker" id="picks"></div>
    <div class="row"><div><label>First name</label><input data-c="first" value="${esc(c.first)}" autocomplete="given-name"></div><div><label>Last name</label><input data-c="last" value="${esc(c.last)}" autocomplete="family-name"></div></div>
    <label>Address</label><input data-c="address" value="${esc(c.address)}">
    <div class="row3"><div><label>City</label><input data-c="city" value="${esc(c.city)}"></div><div><label>State</label><input data-c="state" value="${esc(c.state)}"></div><div><label>ZIP</label><input data-c="zip" inputmode="numeric" value="${esc(c.zip)}"></div></div>
    <div class="row"><div><label>Phone</label><input data-c="phone" inputmode="tel" value="${esc(c.phone)}"></div><div><label>Alternate <span class="opt">(optional)</span></label><input data-c="alt" inputmode="tel" value="${esc(c.alt)}"></div></div>
    <label>Email</label><input data-c="email" type="email" inputmode="email" value="${esc(c.email)}">
    ${D.customer2 ? `<div class="row"><div><label>2nd homeowner first</label><input data-c2="first" value="${esc(D.customer2.first)}"></div><div><label>2nd homeowner last</label><input data-c2="last" value="${esc(D.customer2.last)}"></div></div><button class="linkbtn danger" id="rmc2">Remove 2nd homeowner</button>`
      : `<button class="linkbtn" id="addc2">+ Second homeowner</button>`}
    <label>Client height and weight <span class="opt">(optional)</span></label><input id="hw" value="${esc(D.heightWeight)}" placeholder="5'8&quot; / 210 lbs">
  </div>
  <h2>Lifts</h2>
  <div id="lifts">${D.lifts.map(liftHTML).join("")}</div>
  ${D.lifts.length < 2 ? `<div class="row"><button class="btn secondary" id="addStraight" style="margin:0">+ Straight lift</button><button class="btn secondary" id="addCurved" style="margin:0">+ Curved lift</button></div>` : ""}
  <h2>VPL</h2><div class="card">
    <label for="vpl">Vertical platform lift</label><select id="vpl"><option value="">None</option>${Object.entries(CFG.vpls).map(([k, v]) => `<option value="${k}" ${D.vpl === k ? "selected" : ""}>${k}: up to ${v.max}"</option>`).join("")}</select>
    <div id="vplf" ${D.vpl ? "" : "hidden"}><label>VPL features</label><div class="checks">${Object.entries(CFG.vplFeatures).map(([k, v]) => `<label class="check"><input type="checkbox" data-vf="${k}" ${D.vplFeatures[k] ? "checked" : ""}> ${esc(v.label)}${v.qty ? `<input class="qty" data-vfq="${k}" inputmode="numeric" value="${esc(D.vplFeatures[k] || 2)}">` : ""}</label>`).join("")}</div></div>
  </div>
  <h2>Extras</h2><div class="card"><div class="checks">${Object.entries(CFG.extras).map(([k, v]) => `<label class="check"><input type="checkbox" data-x="${k}" ${ex[k] ? "checked" : ""}> ${esc(v.label)}${v.qty ? `<input class="qty" data-xq="${k}" inputmode="numeric" value="${esc(ex[k] || 1)}">` : ""}</label>`).join("")}</div>
    <label>Grab bars</label><div class="checks">${CFG.grabBars.map((s) => { const g = D.grabBars.find((x) => x.size === s); return `<label class="check"><input type="checkbox" data-gb="${s}" ${g ? "checked" : ""}> ${s}"<input class="qty" data-gbq="${s}" inputmode="numeric" value="${esc(g?.qty || 1)}"></label>`; }).join("")}</div>
  </div>
  <h2>Notes</h2><div class="card">
    <label class="check"><input type="checkbox" id="stop" ${D.stopOnLastStep ? "checked" : ""}> Stop on the last step</label>
    <label>Additional items <span class="opt">(agreement)</span></label><input id="addl" value="${esc(D.additionalItems)}">
    <label>Order sheet notes</label><textarea id="notes">${esc(D.notes)}</textarea>
    <p class="small muted" id="frNote"></p>
  </div>
  <h2>Price</h2><div class="card">
    <div class="row"><div><label>Job #</label><input id="job" value="${esc(D.jobNumber)}" placeholder="MYR281SL" autocapitalize="characters"></div><div><label>Install date</label><input id="inst" value="${esc(D.installDate)}"></div></div>
    <div class="row"><div><label>Contract price</label><input id="price" inputmode="decimal" placeholder="$0" value="${esc(D.price)}"></div><div><label>Deposit</label><input id="dep" inputmode="decimal" placeholder="$0" value="${esc(D.deposit)}"></div></div>
    <label>Pay terms</label><div class="seg" id="pay"><button data-v="Cash">Cash</button><button data-v="Finance">Finance</button></div>
    <table class="lines" style="margin-top:10px"><tr class="total"><td>Unpaid balance</td><td id="bal"></td></tr></table>
  </div>
  <h2>Photos</h2><div class="card">
    <label>Staircase photos <span class="opt">(at least one for a deal)</span></label>
    <label class="btn secondary" style="display:flex;align-items:center;justify-content:center;margin-top:4px">📷 Add photos<input type="file" id="ph" accept="image/*" multiple hidden></label>
    <div class="thumbs" id="thumbs"></div>
    <div id="idWrap" ${D.payType === "Finance" ? "" : "hidden"}><label>Customer ID <span class="opt">(financing, optional)</span></label>
      <label class="btn secondary" style="display:flex;align-items:center;justify-content:center;margin-top:4px">🪪 ${D.idPhoto ? "Replace ID photo" : "Add ID photo"}<input type="file" id="idph" accept="image/*" hidden></label><div class="thumbs" id="idthumb"></div></div>
  </div>
  <h2>Lead notes <span class="opt" style="text-transform:none;letter-spacing:0">(only used when saving as a lead)</span></h2>
  <div class="card"><textarea id="leadNotes" placeholder="Where they are in the decision, objections, follow-up timing">${esc(D.leadNotes)}</textarea></div>
  <button class="linkbtn danger" id="clear">Start over (clear this form)</button>
  <div style="height:40px"></div>
  <div class="sticky"><div class="inner"><button class="btn secondary" id="asLead">Save as lead</button><button class="btn" id="toSign" style="flex:1">Review &amp; sign deal</button></div></div>`;

  // customer
  $$("[data-c]").forEach((el) => (el.oninput = () => { D.customer[el.dataset.c] = el.value; save(); }));
  $$("[data-c2]").forEach((el) => (el.oninput = () => { D.customer2[el.dataset.c2] = el.value; save(); }));
  if ($("#addc2")) $("#addc2").onclick = () => { D.customer2 = { first: "", last: D.customer.last }; save(); render(); };
  if ($("#rmc2")) $("#rmc2").onclick = () => { D.customer2 = null; save(); render(); };
  $("#hw").oninput = (e) => { D.heightWeight = e.target.value; save(); };
  let ft;
  $("#find").oninput = (e) => {
    clearTimeout(ft);
    ft = setTimeout(async () => {
      const q = e.target.value.trim(); if (q.length < 2) { $("#picks").innerHTML = ""; return; }
      try {
        const { contacts } = await api("/contacts?q=" + encodeURIComponent(q));
        $("#picks").innerHTML = contacts.map((x, i) => `<button data-p="${i}"><b>${esc(x.firstName)} ${esc(x.lastName)}</b><br><span class="small muted">${esc([x.phone, x.email, x.city].filter(Boolean).join(" · "))}</span></button>`).join("") || `<p class="small muted">No matches. Just fill in the fields below.</p>`;
        $$("[data-p]", $("#picks")).forEach((b) => (b.onclick = () => {
          const x = contacts[+b.dataset.p];
          Object.assign(D.customer, { first: x.firstName, last: x.lastName, address: x.address, city: x.city, state: x.state || D.customer.state, zip: x.zip, phone: x.phone, email: x.email });
          D.contactId = x.id; save(); render(); toast("Customer filled in");
        }));
      } catch (err) { toast(err.message); }
    }, 350);
  };

  // lifts
  const addLift = (kind) => { const first = Object.entries(CFG.products).find(([, p]) => p.kind === kind)[0]; D.lifts.push({ product: first, outlet: "", flights: kind === "curved" ? [blankFlight(), blankFlight()] : [blankFlight()] }); save(); render(); };
  if ($("#addStraight")) $("#addStraight").onclick = () => addLift("straight");
  if ($("#addCurved")) $("#addCurved").onclick = () => addLift("curved");
  $$(".lift").forEach((card) => {
    const l = D.lifts[+card.dataset.l];
    card.querySelector("[data-rmlift]").onclick = () => { if (confirm("Remove this lift?")) { D.lifts.splice(+card.dataset.l, 1); save(); render(); } };
    card.querySelector("[data-model]").onchange = (e) => { l.product = e.target.value; save(); };
    card.querySelector("[data-outlet]").oninput = (e) => { l.outlet = e.target.value; save(); };
    const af = card.querySelector("[data-addflight]"); if (af) af.onclick = () => { l.flights.push(blankFlight()); save(); render(); };
    $$(".flight", card).forEach((fe) => {
      const f = l.flights[+fe.dataset.f];
      $$("[data-ff]", fe).forEach((inp) => (inp.oninput = () => { f[inp.dataset.ff] = inp.value; save(); }));
      $$("[data-seg]", fe).forEach((sg) => seg(sg, f[sg.dataset.seg], (v) => { f[sg.dataset.seg] = v; save(); }));
      const rm = fe.querySelector("[data-rmflight]"); if (rm) rm.onclick = () => { l.flights.splice(2, 1); l.flights[1].turn = l.flights[1].turn || ""; save(); render(); };
    });
  });

  // VPL / extras
  $("#vpl").onchange = (e) => { D.vpl = e.target.value; $("#vplf").hidden = !D.vpl; save(); };
  $$("[data-vf]").forEach((cb) => (cb.onchange = () => { const k = cb.dataset.vf, q = $(`[data-vfq="${k}"]`); D.vplFeatures[k] = cb.checked ? (q ? parseInt(q.value) || 2 : true) : false; save(); }));
  $$("[data-vfq]").forEach((q) => { q.onclick = (e) => e.preventDefault(); q.oninput = () => { if (D.vplFeatures[q.dataset.vfq]) D.vplFeatures[q.dataset.vfq] = parseInt(q.value) || 2; save(); }; });
  $$("[data-x]").forEach((cb) => (cb.onchange = () => { const k = cb.dataset.x, q = $(`[data-xq="${k}"]`); ex[k] = cb.checked ? (q ? parseInt(q.value) || 1 : true) : false; save(); frNote(); }));
  $$("[data-xq]").forEach((q) => { q.onclick = (e) => e.preventDefault(); q.oninput = () => { if (ex[q.dataset.xq]) ex[q.dataset.xq] = parseInt(q.value) || 1; save(); }; });
  $$("[data-gb]").forEach((cb) => (cb.onchange = () => { gbSync(); }));
  $$("[data-gbq]").forEach((q) => { q.onclick = (e) => e.preventDefault(); q.oninput = gbSync; });
  function gbSync() { D.grabBars = $$("[data-gb]").filter((x) => x.checked).map((x) => ({ size: +x.dataset.gb, qty: parseInt($(`[data-gbq="${x.dataset.gb}"]`).value) || 1 })); save(); }
  const frNote = () => { $("#frNote").textContent = ex.foldingRail ? "Folding rail sold." : 'Agreement will say "Declined Folding Rail".'; };
  frNote();

  // notes & price
  $("#stop").onchange = (e) => { D.stopOnLastStep = e.target.checked; save(); };
  $("#addl").oninput = (e) => { D.additionalItems = e.target.value; save(); };
  $("#notes").oninput = (e) => { D.notes = e.target.value; save(); };
  $("#leadNotes").oninput = (e) => { D.leadNotes = e.target.value; save(); };
  $("#job").oninput = (e) => { D.jobNumber = e.target.value.toUpperCase().trim(); save(); };
  $("#inst").oninput = (e) => { D.installDate = e.target.value; save(); };
  const bal = () => { $("#bal").textContent = usd(num(D.price) - num(D.deposit)); };
  $("#price").oninput = (e) => { D.price = e.target.value; save(); bal(); };
  $("#dep").oninput = (e) => { D.deposit = e.target.value; save(); bal(); };
  seg($("#pay"), D.payType, (v) => { D.payType = v; $("#idWrap").hidden = v !== "Finance"; save(); });
  bal();

  // photos
  const thumbs = () => {
    $("#thumbs").innerHTML = D.photos.map((p, i) => `<figure><img src="${p.thumb}" alt=""><button data-rmph="${i}" aria-label="Remove">×</button></figure>`).join("");
    $$("[data-rmph]").forEach((b) => (b.onclick = () => { D.photos.splice(+b.dataset.rmph, 1); save(); thumbs(); }));
    $("#idthumb").innerHTML = D.idPhoto ? `<figure><img src="${D.idPhoto.thumb}" alt=""><button id="rmid" aria-label="Remove">×</button></figure>` : "";
    if ($("#rmid")) $("#rmid").onclick = () => { D.idPhoto = null; save(); thumbs(); };
  };
  const upload = async (file) => {
    const dataUrl = await compress(file);
    const thumb = await compress(dataURLtoFile(dataUrl), 240, 0.6);
    const { key } = await api("/photo", { dataUrl });
    return { key, thumb };
  };
  $("#ph").onchange = async (e) => {
    for (const f of e.target.files) { try { toast("Uploading photo…", 1500); D.photos.push(await upload(f)); save(); thumbs(); } catch (err) { toast(err.message); } }
    e.target.value = "";
  };
  $("#idph").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { D.idPhoto = await upload(f); save(); thumbs(); } catch (err) { toast(err.message); } e.target.value = ""; };
  thumbs();

  $("#clear").onclick = () => { if (confirm("Clear everything on this form?")) { store.del(DRAFT); D = newDraft(); save(); render(); window.scrollTo(0, 0); } };
  $("#asLead").onclick = saveLead;
  $("#toSign").onclick = reviewDeal;
}
function dataURLtoFile(d) { const [h, b] = d.split(","); const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new File([a], "p.jpg", { type: h.match(/:(.*?);/)[1] }); }
function seg(container, value, onChange) {
  $$("button", container).forEach((b) => {
    b.classList.toggle("on", b.dataset.v === String(value));
    b.onclick = (e) => { e.preventDefault(); $$("button", container).forEach((x) => x.classList.remove("on")); b.classList.add("on"); onChange(b.dataset.v); };
  });
}

// shape the draft for the server
function payload() {
  const lifts = D.lifts.map((l) => ({ ...l, flights: l.flights.map((f, j) => ({ steps: num(f.steps), width: num(f.width), length: num(f.length), side: f.side, turn: j < l.flights.length - 1 ? f.turn : undefined })) }));
  return {
    ...D, lifts, price: num(D.price), deposit: num(D.deposit), photos: undefined, idPhoto: undefined,
    customer: { ...D.customer, first: D.customer.first.trim(), last: D.customer.last.trim() },
    customer2: D.customer2 && (D.customer2.first || D.customer2.last) ? D.customer2 : null,
  };
}
function clientErrors(p) {
  const e = [];
  if (!p.jobNumber) e.push("Job #");
  if (!p.customer.first || !p.customer.last) e.push("customer name");
  if (!p.customer.address) e.push("address");
  if (!p.lifts.length && !p.vpl && !p.extras.scooter && !p.extras.liftChair && !p.extras.pollock) e.push("a lift or product");
  p.lifts.forEach((l, i) => {
    if (!String(l.outlet || "").trim()) e.push(`lift ${i + 1} outlet location`);
    l.flights.forEach((f, j) => {
      const tag = `lift ${i + 1}${l.flights.length > 1 ? ` flight ${j + 1}` : ""}`;
      if (!(f.steps > 0 && f.width > 0 && f.length > 0)) e.push(`${tag} steps/width/length`);
      if (!f.side) e.push(`${tag} install side`);
      if (j < l.flights.length - 1 && !f.turn) e.push(`${tag} turn direction`);
    });
  });
  if (!(p.price > 0)) e.push("contract price");
  if (p.deposit > p.price) e.push("deposit can't exceed the price");
  if (p.lifts.length && !D.photos.length) e.push("a staircase photo");
  return e;
}

async function saveLead() {
  const p = payload();
  if (!p.customer.first || !p.customer.last) return toast("Enter the customer's first and last name");
  if (!p.customer.phone && !p.customer.email) return toast("Enter a phone number or email");
  if (!confirm(`Save ${p.customer.first} ${p.customer.last} as a lead in the follow-up pipeline?`)) return;
  const b = $("#asLead"); b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await api("/lead", { deal: p });
    store.del(DRAFT);
    done({ title: "Lead saved", sub: `${p.customer.first} ${p.customer.last} is in ${r.ghl.stage ? `"${r.ghl.stage}"` : "the Sales Pipeline"}. Follow-up starts from GoHighLevel.`, ghl: r.ghl });
  } catch (e) { toast(e.message, 4000); b.disabled = false; b.textContent = "Save as lead"; }
}

function reviewDeal() {
  const p = payload();
  const errs = clientErrors(p);
  if (errs.length) return toast("Still need: " + errs.join(", "), 5000);
  $("#back").hidden = false; window.scrollTo(0, 0);
  const subject = `${p.jobNumber}: ${p.customer.last}`;
  app.innerHTML = `<h1>Review &amp; sign</h1>
  <div class="card"><b>${esc(p.customer.first)} ${esc(p.customer.last)}${p.customer2 ? ` &amp; ${esc(p.customer2.first)} ${esc(p.customer2.last)}` : ""}</b>
    <div class="small muted">${esc([p.customer.address, p.customer.city, p.customer.state, p.customer.zip].filter(Boolean).join(", "))}</div>
    <table class="lines" style="margin-top:8px">
      ${p.lifts.map((l, i) => `<tr><td>Lift ${i + 1}</td><td>${esc(CFG.products[l.product].label)} · ${l.flights.reduce((s, f) => s + f.steps, 0)} steps</td></tr>`).join("")}
      ${p.vpl ? `<tr><td>VPL</td><td>${esc(p.vpl)}</td></tr>` : ""}
      <tr><td>Folding rail</td><td>${p.extras.foldingRail ? "Sold" : "Declined"}</td></tr>
      <tr><td>Contract price</td><td>${usd(p.price)}</td></tr><tr><td>Deposit</td><td>${usd(p.deposit)}</td></tr>
      <tr class="total"><td>Unpaid balance (${esc(p.payType)})</td><td>${usd(p.price - p.deposit)}</td></tr>
    </table>
    <button class="btn secondary" id="prev">Preview the packet PDF</button>
  </div>
  <h2>Homeowner · ${esc(p.customer.first)} ${esc(p.customer.last)}</h2>${sigHTML("s1")}
  ${p.customer2 ? `<h2>Homeowner · ${esc(p.customer2.first)} ${esc(p.customer2.last)}</h2>${sigHTML("s2")}` : ""}
  <h2>HomePro representative · CJ Dinsmore</h2>${sigHTML("sr")}
  <div class="notice" style="border-left-color:var(--navy);background:#eef4fb">Emails <b>${esc(subject)}</b> to ${esc(CFG.recipients.map((r) => r.replace(/<.*>/, "").trim() || r).join(", "))}, and files it in the Deal Pipeline.</div>
  <button class="btn" id="go">Submit deal</button>`;
  const pads = { owner1: signaturePad($("#s1")), rep: signaturePad($("#sr")) };
  if (p.customer2) pads.owner2 = signaturePad($("#s2"));
  const body = () => ({ deal: { ...p, signatures: Object.fromEntries(Object.entries(pads).map(([k, v]) => [k, v.toDataURL()])) }, photos: D.photos.map((x, i) => ({ key: x.key, caption: `Staircase photo ${i + 1}` })), idPhoto: p.payType === "Finance" && D.idPhoto ? { key: D.idPhoto.key } : null });
  $("#prev").onclick = async () => {
    const pn = `PREVIEW ${subject}.pdf`;
    if (readyFile && readyFile.name === safeName(pn)) { const f = readyFile; readyFile = null; return sharePdf(f, pn); }
    const b = $("#prev"); b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try { const r = await api("/preview", body(), true); await sharePdf(await r.blob(), pn); }
    catch (e) { toast(e.message); }
    b.disabled = false; b.textContent = "Preview the packet PDF";
  };
  $("#go").onclick = async () => {
    if (pads.owner1.isEmpty()) return toast("Homeowner needs to sign");
    if (pads.owner2 && pads.owner2.isEmpty()) return toast("Second homeowner needs to sign");
    if (pads.rep.isEmpty()) return toast("You need to sign");
    if (!confirm(`Send ${subject} to HomePro now?`)) return;
    $("#go").disabled = true; $("#go").innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api("/deal", body());
      if (r.email.ok) store.del(DRAFT);
      done({ title: r.email.ok ? "Deal submitted" : "Saved, but the email didn't send", sub: r.email.ok ? `${subject} was emailed to the HomePro team.` : `Email error: ${r.email.error}`, link: r.link, ghl: r.ghl, bad: !r.email.ok, packetKey: r.packetKey, subject, oppId: r.oppId });
    } catch (e) { toast(e.message, 5000); $("#go").disabled = false; $("#go").textContent = "Submit deal"; }
  };
}

function done(d) {
  $("#back").hidden = true; window.scrollTo(0, 0);
  const bad = (d.ghl?.log || []).filter((s) => !s.ok);
  const missing = d.ghl?.missing || [];
  app.innerHTML = `<div class="card" style="text-align:center;padding:26px 16px"><div style="font-size:40px">${d.bad ? "⚠️" : "✅"}</div><h1 style="margin:6px 0">${esc(d.title)}</h1><p class="muted">${esc(d.sub)}</p>
    ${d.bad && d.packetKey ? `<button class="btn" id="retry">Retry email</button>` : ""}
    ${d.link ? `<button class="btn secondary" id="dl">Download / share the packet</button>` : ""}</div>
    ${bad.length || missing.length ? `<div class="notice"><b>GoHighLevel needs a look:</b><ul>${bad.map((s) => `<li>${esc(s.step)}<br><span class="small muted">${esc(s.error)}</span></li>`).join("")}${missing.length ? `<li>Fields not found: ${esc(missing.join(", "))}</li>` : ""}</ul></div>` : `<p class="muted">Synced to GoHighLevel.</p>`}
    <button class="btn ${d.bad ? "secondary" : ""}" id="new">${d.bad ? "Back to the form" : "Start a new job"}</button>`;
  $("#new").onclick = () => form();
  if ($("#dl")) $("#dl").onclick = () => downloadPacket(d.link, `${d.subject || "Job packet"}.pdf`);
  if ($("#retry")) $("#retry").onclick = async () => {
    const b = $("#retry"); b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api("/resend", { packetKey: d.packetKey, subject: d.subject, oppId: d.oppId });
      if (!r.ok) throw new Error(r.error);
      store.del(DRAFT);
      done({ ...d, bad: false, title: "Deal submitted", sub: `${d.subject} was emailed to the HomePro team.` });
    } catch (e) { toast("Still failing: " + e.message, 6000); b.disabled = false; b.textContent = "Retry email"; }
  };
}

let readyFile = null; // iPhone: if the share sheet needs a fresh tap, the file waits here
async function downloadPacket(link, name) {
  if (readyFile && readyFile.name === safeName(name)) { const f = readyFile; readyFile = null; return sharePdf(f, name); }
  try {
    toast("Getting the PDF…", 1500);
    const res = await fetch(link + "&dl=1");
    if (!res.ok) throw new Error("Couldn't load the packet");
    await sharePdf(await res.blob(), name);
  } catch (e) { toast(e.message); }
}
const safeName = (n) => n.replace(/[\\/:*?"<>|]/g, "-");
async function sharePdf(blob, name) {
  {
    const file = blob instanceof File ? blob : new File([blob], safeName(name), { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) {
        if (e.name === "AbortError") return;
        if (e.name === "NotAllowedError") { readyFile = file; toast("PDF is ready. Tap the button again to save or share it.", 5000); return; }
      }
    }
    const u = URL.createObjectURL(file);
    const a = document.createElement("a"); a.href = u; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 10000);
  }
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
token ? form() : login();
