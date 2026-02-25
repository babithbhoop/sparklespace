import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants & Helpers ───
const WA_TAX_RATE = 0.1025;
const DEFAULT_RATE = 22;
const STORAGE_KEY = "sparkle_space_data";
const THEA_EMAIL = "babith@hotmail.com";
const THEA_PHONE = "425-428-8687";

// EmailJS free tier: 200 emails/month — perfect for a small biz
const EMAILJS_CDN = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";

// Default EmailJS credentials (Thea's account)
const DEFAULT_EMAILJS = {
  serviceId: "service_TheaApp",
  templateId: "template_x9q340z",
  publicKey: "Zp60lxBPh3IE_O58V",
};

// Load EmailJS script dynamically
function loadEmailJS() {
  return new Promise((resolve, reject) => {
    if (window.emailjs) return resolve(window.emailjs);
    const existing = document.querySelector(`script[src="${EMAILJS_CDN}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.emailjs));
      return;
    }
    const script = document.createElement("script");
    script.src = EMAILJS_CDN;
    script.onload = () => resolve(window.emailjs);
    script.onerror = () => reject(new Error("Failed to load EmailJS"));
    document.head.appendChild(script);
  });
}

// Send email via EmailJS
async function sendEmail({ to, cc, subject, htmlBody, settings }) {
  const serviceId = settings?.emailjsServiceId || DEFAULT_EMAILJS.serviceId;
  const templateId = settings?.emailjsTemplateId || DEFAULT_EMAILJS.templateId;
  const publicKey = settings?.emailjsPublicKey || DEFAULT_EMAILJS.publicKey;

  if (!serviceId || !templateId || !publicKey) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }

  const ejs = await loadEmailJS();
  ejs.init(publicKey);

  return ejs.send(serviceId, templateId, {
    to_email: to,
    cc_email: cc || "",
    subject: subject,
    message_html: htmlBody,
    from_name: "SparkleSpace by Thea",
    reply_to: THEA_EMAIL,
  });
}

// Build pretty HTML email body
function buildEmailHTML({ greeting, sections, cta, footer }) {
  const sectionHTML = sections.map(s => 
    `<div style="margin-bottom:16px;">` +
    (s.title ? `<div style="font-weight:700;color:#7C3AED;font-size:14px;margin-bottom:6px;">${s.title}</div>` : "") +
    `<div style="color:#444;font-size:13px;line-height:1.6;white-space:pre-line;">${s.content}</div>` +
    `</div>`
  ).join("");

  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <div style="background:linear-gradient(135deg,#FF6B9D,#C084FC,#60A5FA);padding:20px 24px;border-radius:16px 16px 0 0;color:#fff;">
        <h1 style="margin:0;font-size:20px;">✨ SparkleSpace</h1>
        <p style="margin:4px 0 0;font-size:12px;opacity:0.9;">by Thea • Organization Magic</p>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 16px 16px;">
        <p style="font-size:15px;color:#333;margin:0 0 16px;">${greeting}</p>
        ${sectionHTML}
        ${cta ? `<div style="background:linear-gradient(135deg,#FFF5F7,#F3E8FF);border-radius:12px;padding:14px;text-align:center;margin:16px 0;font-size:14px;font-weight:700;color:#7C3AED;">${cta}</div>` : ""}
        <div style="border-top:1px solid #eee;padding-top:16px;margin-top:16px;font-size:12px;color:#888;line-height:1.5;">
          ${footer || `✨ Thea<br>SparkleSpace Organization<br>📱 ${THEA_PHONE}<br>📧 ${THEA_EMAIL}`}
        </div>
      </div>
    </div>`;
}

const generateId = () => Math.random().toString(36).substr(2, 9);
const formatCurrency = (n) => `$${(n || 0).toFixed(2)}`;
const formatDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const formatTime = (d) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const SPACE_TYPES = [
  { label: "Pantry Refresh", emoji: "🥫", baseHours: 2 },
  { label: "Pantry Deep Clean", emoji: "✨", baseHours: 4 },
  { label: "Closet Declutter", emoji: "👗", baseHours: 3 },
  { label: "Garage Organization", emoji: "🔧", baseHours: 6 },
  { label: "Storage Room", emoji: "📦", baseHours: 5 },
  { label: "Kitchen Cabinets", emoji: "🍽️", baseHours: 3 },
  { label: "Bathroom Storage", emoji: "🧴", baseHours: 1.5 },
  { label: "Kids Room", emoji: "🧸", baseHours: 3 },
  { label: "Home Office", emoji: "💻", baseHours: 2.5 },
  { label: "Custom", emoji: "🎯", baseHours: 0 },
];

const SIZE_MULTIPLIERS = { small: 0.7, medium: 1.0, large: 1.5, xlarge: 2.0 };
const CLUTTER_MULTIPLIERS = { light: 0.8, moderate: 1.0, heavy: 1.3, extreme: 1.6 };
const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_SLOTS = ["Morning (8-12)", "Afternoon (12-4)", "Evening (4-8)"];

const STATUS_COLORS = {
  assessment: { bg: "#FFF3E0", text: "#E65100", border: "#FFB74D" },
  "estimate-sent": { bg: "#FFF8E1", text: "#F57F17", border: "#FFD54F" },
  "estimate-approved": { bg: "#E8F5E9", text: "#2E7D32", border: "#81C784" },
  "schedule-sent": { bg: "#E1F5FE", text: "#0277BD", border: "#4FC3F7" },
  scheduled: { bg: "#E3F2FD", text: "#1565C0", border: "#64B5F6" },
  "in-progress": { bg: "#FCE4EC", text: "#C62828", border: "#EF9A9A" },
  completed: { bg: "#E8F5E9", text: "#2E7D32", border: "#81C784" },
  invoiced: { bg: "#F3E5F5", text: "#6A1B9A", border: "#CE93D8" },
  paid: { bg: "#E0F7FA", text: "#00695C", border: "#80CBC4" },
};

function createEmptySpace() {
  return {
    id: generateId(),
    spaceType: SPACE_TYPES[0].label,
    size: "medium",
    clutterLevel: "moderate",
    notes: "",
    beforePhotos: [],
    afterPhotos: [],
    estimatedHours: 0,
  };
}

function estimateSpaceHours(spaceType, size, clutterLevel) {
  const base = SPACE_TYPES.find((j) => j.label === spaceType)?.baseHours || 3;
  const sizeMult = SIZE_MULTIPLIERS[size] || 1;
  const clutterMult = CLUTTER_MULTIPLIERS[clutterLevel] || 1;
  return Math.round(base * sizeMult * clutterMult * 10) / 10;
}

function totalSpacesHours(spaces) {
  return spaces.reduce((sum, s) => sum + (s.estimatedHours || estimateSpaceHours(s.spaceType, s.size, s.clutterLevel)), 0);
}

function getJobEmojis(spaces) {
  if (!spaces || spaces.length === 0) return "📦";
  return [...new Set(spaces.map(s => SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦"))].join("");
}

function getJobSummary(spaces) {
  if (!spaces || spaces.length === 0) return "No spaces";
  if (spaces.length === 1) return spaces[0].spaceType;
  return `${spaces.length} spaces`;
}

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return { jobs: [], clients: [], settings: { hourlyRate: DEFAULT_RATE }, feedback: [] };
}

function saveData(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
}

// ─── Main App ───
export default function SparkleSpaceApp() {
  const [data, setData] = useState(loadData);
  const [currentView, setCurrentView] = useState("dashboard");
  const [selectedJob, setSelectedJob] = useState(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { saveData(data); }, [data]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const updateJob = (id, updates) => {
    setData((prev) => ({ ...prev, jobs: prev.jobs.map((j) => (j.id === id ? { ...j, ...updates } : j)) }));
  };

  const addJob = (job) => {
    setData((prev) => ({ ...prev, jobs: [job, ...prev.jobs] }));
    showToast("Job created! ✨");
  };

  const updateSettings = (settings) => {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, ...settings } }));
  };

  const openJob = (id) => { setSelectedJob(id); setCurrentView("job-detail"); };

  const navItems = [
    { id: "dashboard", label: "Home", emoji: "🏠" },
    { id: "jobs", label: "Jobs", emoji: "📋" },
    { id: "calendar", label: "Calendar", emoji: "📅" },
    { id: "analytics", label: "Stats", emoji: "📊" },
    { id: "settings", label: "Settings", emoji: "⚙️" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #FFF5F7 0%, #FFF0E5 30%, #F0F7FF 70%, #F5F0FF 100%)", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet" />
      
      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: toast.type === "success" ? "#10B981" : "#EF4444", color: "#fff", padding: "12px 24px", borderRadius: 16, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.15)", animation: "slideDown 0.3s ease" }}>
          {toast.msg}
        </div>
      )}

      <header style={{ background: "linear-gradient(135deg, #FF6B9D 0%, #C084FC 50%, #60A5FA 100%)", padding: "16px 20px", color: "#fff", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 20px rgba(192,132,252,0.3)" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>✨ SparkleSpace</h1>
            <p style={{ fontSize: 11, opacity: 0.9, margin: 0, fontWeight: 500 }}>by Thea • Organization Magic</p>
          </div>
          <button onClick={() => { setShowNewJob(true); setCurrentView("jobs"); }} style={{ background: "rgba(255,255,255,0.25)", border: "2px solid rgba(255,255,255,0.5)", borderRadius: 14, padding: "8px 16px", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", backdropFilter: "blur(10px)" }}>
            + New Job
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 600, margin: "0 auto", padding: "16px 16px 100px" }}>
        {currentView === "dashboard" && <Dashboard data={data} setCurrentView={setCurrentView} openJob={openJob} setShowNewJob={setShowNewJob} />}
        {currentView === "jobs" && <JobsList data={data} openJob={openJob} showNewJob={showNewJob} setShowNewJob={setShowNewJob} addJob={addJob} updateJob={updateJob} settings={data.settings} showToast={showToast} />}
        {currentView === "job-detail" && selectedJob && <JobDetail job={data.jobs.find(j => j.id === selectedJob)} updateJob={updateJob} settings={data.settings} showToast={showToast} setCurrentView={setCurrentView} />}
        {currentView === "calendar" && <CalendarView data={data} openJob={openJob} />}
        {currentView === "analytics" && <Analytics data={data} />}
        {currentView === "settings" && <Settings settings={data.settings} updateSettings={updateSettings} showToast={showToast} />}
      </main>

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(0,0,0,0.06)", padding: "8px 0 max(8px, env(safe-area-inset-bottom))", zIndex: 100 }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", justifyContent: "space-around" }}>
          {navItems.map((item) => (
            <button key={item.id} onClick={() => setCurrentView(item.id)} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", padding: "4px 12px", borderRadius: 12, transition: "all 0.2s", ...(currentView === item.id ? { background: "linear-gradient(135deg, #FFE0EC, #E8D5FF)", transform: "scale(1.05)" } : {}) }}>
              <span style={{ fontSize: 20 }}>{item.emoji}</span>
              <span style={{ fontSize: 10, fontWeight: currentView === item.id ? 700 : 500, color: currentView === item.id ? "#C084FC" : "#999" }}>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <style>{`
        @keyframes slideDown { from { opacity: 0; transform: translate(-50%, -20px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        input, textarea, select { font-family: 'DM Sans', sans-serif; }
        button { transition: all 0.15s ease; }
        button:active { transform: scale(0.97); }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }
      `}</style>
    </div>
  );
}

// ─── Reusable UI Components ───
function Card({ children, style = {}, onClick }) {
  return (
    <div onClick={onClick} style={{ background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.04)", animation: "fadeIn 0.3s ease", cursor: onClick ? "pointer" : "default", transition: "all 0.2s", ...style }} onMouseEnter={(e) => { if (onClick) e.currentTarget.style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { if (onClick) e.currentTarget.style.transform = ""; }}>
      {children}
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>{label}</label>}
      <input {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "2px solid #F0E6FF", fontSize: 14, outline: "none", transition: "border-color 0.2s", background: "#FDFBFF", ...props.style }} onFocus={(e) => e.target.style.borderColor = "#C084FC"} onBlur={(e) => e.target.style.borderColor = "#F0E6FF"} />
    </div>
  );
}

function TextArea({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>{label}</label>}
      <textarea {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "2px solid #F0E6FF", fontSize: 14, outline: "none", minHeight: 80, resize: "vertical", background: "#FDFBFF", ...props.style }} onFocus={(e) => e.target.style.borderColor = "#C084FC"} onBlur={(e) => e.target.style.borderColor = "#F0E6FF"} />
    </div>
  );
}

function Select({ label, options, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>{label}</label>}
      <select {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "2px solid #F0E6FF", fontSize: 14, outline: "none", background: "#FDFBFF", cursor: "pointer", ...props.style }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function GradientButton({ children, onClick, style = {}, variant = "primary" }) {
  const styles = {
    primary: { background: "linear-gradient(135deg, #FF6B9D, #C084FC)", color: "#fff" },
    secondary: { background: "linear-gradient(135deg, #E0E7FF, #F3E8FF)", color: "#6B21A8" },
    success: { background: "linear-gradient(135deg, #34D399, #60A5FA)", color: "#fff" },
    danger: { background: "linear-gradient(135deg, #FB7185, #F43F5E)", color: "#fff" },
  };
  return (
    <button onClick={onClick} style={{ border: "none", borderRadius: 14, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer", width: "100%", fontFamily: "'DM Sans', sans-serif", ...styles[variant], ...style }}>
      {children}
    </button>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.assessment;
  return (
    <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
      {status}
    </span>
  );
}

function PhotoUpload({ photos = [], onPhotosChange, label }) {
  const fileRef = useRef(null);
  const handleFiles = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        onPhotosChange([...photos, { id: generateId(), url: ev.target.result, timestamp: new Date().toISOString() }]);
      };
      reader.readAsDataURL(file);
    });
  };
  const removePhoto = (id) => onPhotosChange(photos.filter(p => p.id !== id));
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 8, display: "block" }}>{label}</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {photos.map(p => (
          <div key={p.id} style={{ position: "relative", width: 72, height: 72, borderRadius: 12, overflow: "hidden" }}>
            <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button onClick={(e) => { e.stopPropagation(); removePhoto(p.id); }} style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        ))}
        <button onClick={() => fileRef.current.click()} style={{ width: 72, height: 72, borderRadius: 12, border: "2px dashed #D8B4FE", background: "#FAF5FF", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 10, color: "#A855F7", fontWeight: 600, gap: 2 }}>
          <span style={{ fontSize: 20 }}>📸</span>Add
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" onChange={handleFiles} style={{ display: "none" }} />
    </div>
  );
}

// ─── Space Editor Card (used in both NewJob and JobDetail) ───
function SpaceEditorCard({ space, index, total, onUpdate, onRemove, collapsed, onToggle }) {
  const emoji = SPACE_TYPES.find(t => t.label === space.spaceType)?.emoji || "📦";
  const hours = estimateSpaceHours(space.spaceType, space.size, space.clutterLevel);

  // Sync estimated hours when params change (only if not manually overridden)
  useEffect(() => {
    if (!space._manualOverride) {
      const autoHours = estimateSpaceHours(space.spaceType, space.size, space.clutterLevel);
      if (space.estimatedHours !== autoHours) {
        onUpdate({ ...space, estimatedHours: autoHours });
      }
    }
  }, [space.spaceType, space.size, space.clutterLevel]);

  // Batch update: sets multiple fields at once to avoid stale state issues
  const updateFields = (changes) => {
    onUpdate({ ...space, ...changes });
  };

  const updateField = (key, value) => {
    const updated = { ...space, [key]: value };
    if (key === "estimatedHours") updated._manualOverride = true;
    onUpdate(updated);
  };

  return (
    <div style={{ background: "#fff", border: "2px solid #F0E6FF", borderRadius: 16, marginBottom: 10, overflow: "hidden", animation: "fadeIn 0.3s ease" }}>
      {/* Collapsed header — always visible */}
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer", background: collapsed ? "#FDFBFF" : "linear-gradient(135deg, #FFF5F7, #F3E8FF)" }}>
        <span style={{ fontSize: 22 }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            {space.spaceType}
            <span style={{ fontWeight: 500, color: "#A855F7", marginLeft: 6, fontSize: 11 }}>
              {space.estimatedHours || hours}h
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#999" }}>
            {space.size} • {space.clutterLevel} clutter
          </div>
        </div>
        <span style={{ fontSize: 11, color: "#C084FC", fontWeight: 700 }}>{collapsed ? "▼" : "▲"}</span>
        {total > 1 && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 8, padding: "4px 8px", fontSize: 11, color: "#E11D48", fontWeight: 700, cursor: "pointer" }}>
            ✕
          </button>
        )}
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div style={{ padding: "0 14px 14px" }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6, display: "block", marginTop: 10 }}>Space Type</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
            {SPACE_TYPES.map((t) => (
              <button key={t.label} onClick={() => updateFields({ spaceType: t.label, _manualOverride: false })} style={{ padding: "8px 6px", borderRadius: 10, border: space.spaceType === t.label ? "2px solid #C084FC" : "1.5px solid #E5E7EB", background: space.spaceType === t.label ? "#F3E8FF" : "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                <span style={{ fontSize: 16, display: "block" }}>{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6, display: "block" }}>Size</label>
          <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
            {Object.keys(SIZE_MULTIPLIERS).map((s) => (
              <button key={s} onClick={() => updateFields({ size: s, _manualOverride: false })} style={{ flex: 1, padding: "7px 3px", borderRadius: 8, border: space.size === s ? "2px solid #C084FC" : "1.5px solid #E5E7EB", background: space.size === s ? "#F3E8FF" : "#fff", cursor: "pointer", fontSize: 10, fontWeight: 600, textTransform: "capitalize" }}>
                {s === "xlarge" ? "XL" : s}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6, display: "block" }}>Clutter Level</label>
          <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
            {Object.keys(CLUTTER_MULTIPLIERS).map((c) => (
              <button key={c} onClick={() => updateFields({ clutterLevel: c, _manualOverride: false })} style={{ flex: 1, padding: "7px 3px", borderRadius: 8, border: space.clutterLevel === c ? "2px solid #C084FC" : "1.5px solid #E5E7EB", background: space.clutterLevel === c ? "#F3E8FF" : "#fff", cursor: "pointer", fontSize: 10, fontWeight: 600, textTransform: "capitalize" }}>
                {c}
              </button>
            ))}
          </div>

          <TextArea label="Notes for this space" placeholder="What needs to be done here?" value={space.notes || ""} onChange={(e) => updateField("notes", e.target.value)} />
          
          <PhotoUpload label="📸 Before Photos" photos={space.beforePhotos || []} onPhotosChange={(p) => updateField("beforePhotos", p)} />

          {/* Per-space estimate with override */}
          <div style={{ background: "linear-gradient(135deg, #FFF5F7, #F3E8FF)", borderRadius: 12, padding: 10, marginTop: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "#888" }}>🤖 Auto: {hours}h</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#888" }}>Override:</span>
                <input type="number" step="0.5" min="0" value={space.estimatedHours || hours} onChange={(e) => updateField("estimatedHours", parseFloat(e.target.value) || 0)} style={{ width: 60, padding: "4px 8px", borderRadius: 8, border: "1.5px solid #D8B4FE", fontSize: 12, textAlign: "center", outline: "none", background: "#fff" }} />
                <span style={{ fontSize: 11, color: "#888" }}>h</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Schedule Days Editor (reusable) ───
function ScheduleDaysEditor({ scheduleDays, totalHours, onChange }) {
  const addDay = () => {
    onChange([...scheduleDays, { id: generateId(), date: "", startTime: "09:00", hours: 0 }]);
  };

  const updateDay = (index, changes) => {
    const updated = [...scheduleDays];
    updated[index] = { ...updated[index], ...changes };
    onChange(updated);
  };

  const removeDay = (index) => {
    onChange(scheduleDays.filter((_, i) => i !== index));
  };

  const scheduledH = scheduleDays.reduce((s, d) => s + (d.hours || 0), 0);
  const remaining = Math.max(0, totalHours - scheduledH);
  const pct = totalHours > 0 ? Math.min(100, (scheduledH / totalHours) * 100) : 0;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#666" }}>📅 Schedule Days</label>
        <span style={{ fontSize: 11, color: "#A855F7", fontWeight: 700 }}>{scheduledH}h of {totalHours}h</span>
      </div>
      
      <div style={{ marginBottom: 10 }}>
        <div style={{ height: 8, borderRadius: 4, background: "#F3E8FF", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 4, background: pct >= 100 ? "linear-gradient(90deg, #34D399, #60A5FA)" : "linear-gradient(90deg, #FF6B9D, #C084FC)", width: `${pct}%`, transition: "width 0.4s" }} />
        </div>
        <div style={{ fontSize: 11, color: remaining > 0 ? "#E11D48" : "#059669", fontWeight: 600, marginTop: 3 }}>
          {remaining > 0 ? `${remaining}h still needs scheduling` : "✅ All hours scheduled!"}
        </div>
      </div>

      {scheduleDays.map((day, index) => (
        <div key={day.id} style={{ background: "#FDFBFF", border: "1.5px solid #F0E6FF", borderRadius: 14, padding: 12, marginBottom: 8, animation: "fadeIn 0.2s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED" }}>Day {index + 1} {day.date ? `• ${formatDate(day.date)}` : ""}</span>
            <button onClick={() => removeDay(index)} style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 8, padding: "3px 8px", fontSize: 11, color: "#E11D48", fontWeight: 700, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#999", display: "block", marginBottom: 3 }}>Date</label>
              <input type="date" value={day.date} onChange={(e) => updateDay(index, { date: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #F0E6FF", fontSize: 13, outline: "none", background: "#fff" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#999", display: "block", marginBottom: 3 }}>Start Time</label>
              <input type="time" value={day.startTime} onChange={(e) => updateDay(index, { startTime: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #F0E6FF", fontSize: 13, outline: "none", background: "#fff" }} />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: "#999", display: "block", marginBottom: 3 }}>Hours Thea will work this day</label>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[1, 1.5, 2, 3, 4, 5, 6, 8].map(h => (
                <button key={h} onClick={() => updateDay(index, { hours: h })} style={{ padding: "5px 10px", borderRadius: 8, border: day.hours === h ? "2px solid #C084FC" : "1.5px solid #E5E7EB", background: day.hours === h ? "#F3E8FF" : "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, color: day.hours === h ? "#7C3AED" : "#666" }}>
                  {h}h
                </button>
              ))}
            </div>
            <input type="number" step="0.5" min="0.5" max="12" placeholder="Custom hours" value={day.hours || ""} onChange={(e) => updateDay(index, { hours: parseFloat(e.target.value) || 0 })} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #F0E6FF", fontSize: 12, outline: "none", background: "#fff", marginTop: 6 }} />
          </div>
        </div>
      ))}

      <button onClick={addDay} style={{ width: "100%", padding: "11px", borderRadius: 12, border: "2px dashed #C084FC", background: "linear-gradient(135deg, #FAF5FF, #FFF5F7)", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        ➕ Add a Day
      </button>
    </div>
  );
}

// ─── Dashboard ───
function Dashboard({ data, setCurrentView, openJob, setShowNewJob }) {
  const stats = {
    active: data.jobs.filter((j) => ["assessment", "estimate-sent", "estimate-approved", "schedule-sent", "scheduled", "in-progress"].includes(j.status)).length,
    completed: data.jobs.filter((j) => j.status === "completed" || j.status === "paid").length,
    revenue: data.jobs.filter((j) => j.status === "paid").reduce((s, j) => s + (j.finalAmount || 0), 0),
    pending: data.jobs.filter((j) => j.status === "invoiced").reduce((s, j) => s + (j.invoiceAmount || 0), 0),
  };

  const upcoming = data.jobs.filter((j) => j.status === "scheduled" && j.scheduledDate).sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate)).slice(0, 3);
  const needsAction = data.jobs.filter((j) => ["assessment", "estimate-sent", "estimate-approved", "schedule-sent", "in-progress"].includes(j.status)).slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ background: "linear-gradient(135deg, #FF6B9D 0%, #C084FC 50%, #60A5FA 100%)", color: "#fff", border: "none" }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>Hey Thea! 👋</h2>
        <p style={{ fontSize: 13, opacity: 0.9, margin: 0 }}>Ready to make some spaces sparkle today? ✨</p>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => { setShowNewJob(true); setCurrentView("jobs"); }} style={{ flex: 1, background: "rgba(255,255,255,0.25)", border: "2px solid rgba(255,255,255,0.4)", borderRadius: 12, padding: "10px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", backdropFilter: "blur(10px)" }}>✨ New Assessment</button>
          <button onClick={() => setCurrentView("calendar")} style={{ flex: 1, background: "rgba(255,255,255,0.15)", border: "2px solid rgba(255,255,255,0.3)", borderRadius: 12, padding: "10px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>📅 My Calendar</button>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Active Jobs", value: stats.active, emoji: "🔥", color: "#FF6B9D" },
          { label: "Completed", value: stats.completed, emoji: "✅", color: "#34D399" },
          { label: "Earned", value: formatCurrency(stats.revenue), emoji: "💰", color: "#C084FC" },
          { label: "Pending", value: formatCurrency(stats.pending), emoji: "⏳", color: "#60A5FA" },
        ].map((s) => (
          <Card key={s.label} style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>{s.emoji}</div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#999", fontWeight: 600 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {needsAction.length > 0 && (
        <div>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, fontWeight: 700, color: "#333", margin: "0 0 10px" }}>⚡ Needs Action</h3>
          {needsAction.map((job) => (
            <Card key={job.id} onClick={() => openJob(job.id)} style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{job.clientName}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>{getJobEmojis(job.spaces)} {getJobSummary(job.spaces)}</div>
                </div>
                <StatusBadge status={job.status} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <div>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, fontWeight: 700, color: "#333", margin: "0 0 10px" }}>📅 Coming Up</h3>
          {upcoming.map((job) => (
            <Card key={job.id} onClick={() => openJob(job.id)} style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{job.clientName}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>{formatDate(job.scheduledDate)}{job.scheduledTime ? ` • ${job.scheduledTime}` : ""}</div>
                </div>
                <span style={{ fontSize: 20 }}>{getJobEmojis(job.spaces)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {data.jobs.length === 0 && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🌟</div>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 800, color: "#333", margin: "0 0 8px" }}>Your journey starts here!</h3>
          <p style={{ fontSize: 13, color: "#888", margin: "0 0 16px" }}>Create your first job assessment to get started</p>
          <GradientButton onClick={() => { setShowNewJob(true); setCurrentView("jobs"); }}>✨ Create First Job</GradientButton>
        </Card>
      )}
    </div>
  );
}

// ─── Jobs List ───
function JobsList({ data, openJob, showNewJob, setShowNewJob, addJob, updateJob, settings, showToast }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? data.jobs : data.jobs.filter((j) => j.status === filter);

  return (
    <div>
      {showNewJob && <NewJobForm onClose={() => setShowNewJob(false)} onSave={addJob} settings={settings} />}
      {!showNewJob && (
        <>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, marginBottom: 12 }}>
            {["all", "assessment", "estimate-sent", "estimate-approved", "schedule-sent", "scheduled", "in-progress", "completed", "invoiced", "paid"].map((f) => (
              <button key={f} onClick={() => setFilter(f)} style={{ whiteSpace: "nowrap", padding: "6px 14px", borderRadius: 20, border: filter === f ? "2px solid #C084FC" : "2px solid #E5E7EB", background: filter === f ? "#F3E8FF" : "#fff", color: filter === f ? "#7C3AED" : "#666", fontWeight: 600, fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}>
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <Card style={{ textAlign: "center", padding: 30 }}>
              <div style={{ fontSize: 36 }}>📭</div>
              <p style={{ color: "#888", fontSize: 13 }}>No jobs found for this filter</p>
            </Card>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((job) => <JobCard key={job.id} job={job} onClick={() => openJob(job.id)} />)}
          </div>
        </>
      )}
    </div>
  );
}

function JobCard({ job, onClick }) {
  const spaces = job.spaces || [];
  return (
    <Card onClick={onClick} style={{ padding: 14 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: "linear-gradient(135deg, #FFF0E5, #F3E8FF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: spaces.length > 2 ? 14 : 20, flexShrink: 0 }}>
          {getJobEmojis(spaces)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{job.clientName}</div>
            <StatusBadge status={job.status} />
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
            {spaces.length === 1 ? spaces[0].spaceType : `${spaces.length} spaces`} • {job.estimatedHours}h est.
          </div>
          {spaces.length > 1 && (
            <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
              {spaces.map(s => (
                <span key={s.id} style={{ fontSize: 9, background: "#F3E8FF", color: "#7C3AED", padding: "2px 6px", borderRadius: 6, fontWeight: 600 }}>
                  {SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji} {s.spaceType}
                </span>
              ))}
            </div>
          )}
          {job.scheduleDays && job.scheduleDays.length > 0 ? (
            <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
              {job.scheduleDays.filter(d => d.date).map((d, i) => (
                <span key={d.id || i} style={{ fontSize: 9, background: "#EFF6FF", color: "#2563EB", padding: "2px 6px", borderRadius: 6, fontWeight: 600 }}>
                  📅 {formatDate(d.date)} • {d.hours}h
                </span>
              ))}
            </div>
          ) : job.scheduledDate ? (
            <div style={{ fontSize: 11, color: "#A855F7", fontWeight: 600, marginTop: 3 }}>📅 {formatDate(job.scheduledDate)}</div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// ─── New Job Form (with multi-space) ───
function NewJobForm({ onClose, onSave, settings }) {
  const [step, setStep] = useState(1);
  const [spaces, setSpaces] = useState([createEmptySpace()]);
  const [expandedSpace, setExpandedSpace] = useState(0);
  const [form, setForm] = useState({
    clientName: "", clientPhone: "", clientEmail: "", clientAddress: "",
    notes: "",
    preferredDays: [], preferredTimes: [], blockedDays: [],
    scheduleDays: [], // Array of { id, date, startTime, hours }
    paymentMethod: "cash",
    discountType: "none", discountValue: 0,
  });

  const totalHours = totalSpacesHours(spaces);
  const totalCost = totalHours * settings.hourlyRate;

  const calculateTotal = () => {
    let base = totalCost;
    if (form.discountType === "percent") base -= base * (form.discountValue / 100);
    else if (form.discountType === "dollar") base -= form.discountValue;
    if (form.paymentMethod !== "cash") base += base * WA_TAX_RATE;
    return Math.max(0, base);
  };

  const handleSave = () => {
    if (!form.clientName.trim()) return;
    const sortedDays = [...form.scheduleDays].filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
    onSave({
      id: generateId(), ...form, spaces,
      scheduleDays: sortedDays,
      scheduledDate: sortedDays[0]?.date || "",
      scheduledTime: sortedDays[0]?.startTime || "",
      estimatedHours: totalHours, estimatedCost: totalCost,
      status: "assessment", createdAt: new Date().toISOString(),
      totalEstimate: calculateTotal(),
      actualStartTime: null, actualEndTime: null, actualHours: null,
      invoiceAmount: null, finalAmount: null, feedback: null,
    });
    onClose();
  };

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const addSpace = () => {
    setSpaces([...spaces, createEmptySpace()]);
    setExpandedSpace(spaces.length);
  };

  const updateSpace = (index, updated) => {
    const newSpaces = [...spaces];
    newSpaces[index] = updated;
    setSpaces(newSpaces);
  };

  const removeSpace = (index) => {
    if (spaces.length <= 1) return;
    setSpaces(spaces.filter((_, i) => i !== index));
    if (expandedSpace >= index && expandedSpace > 0) setExpandedSpace(expandedSpace - 1);
  };

  const totalSteps = 4;

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {Array.from({ length: totalSteps }, (_, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: i < step ? "linear-gradient(90deg, #FF6B9D, #C084FC)" : "#E5E7EB", transition: "all 0.3s" }} />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, margin: 0 }}>
          {step === 1 && "👤 Client Info"}
          {step === 2 && "🏠 Spaces to Organize"}
          {step === 3 && "📅 Scheduling"}
          {step === 4 && "💰 Estimate"}
        </h2>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999" }}>✕</button>
      </div>

      {/* Step 1: Client */}
      {step === 1 && (
        <Card>
          <Input label="Client Name *" placeholder="e.g. Sarah Johnson" value={form.clientName} onChange={(e) => update("clientName", e.target.value)} />
          <Input label="Phone" placeholder="425-555-1234" type="tel" value={form.clientPhone} onChange={(e) => update("clientPhone", e.target.value)} />
          <Input label="Email" placeholder="sarah@email.com" type="email" value={form.clientEmail} onChange={(e) => update("clientEmail", e.target.value)} />
          <Input label="Address" placeholder="123 Main St, Bothell WA" value={form.clientAddress} onChange={(e) => update("clientAddress", e.target.value)} />
        </Card>
      )}

      {/* Step 2: Spaces (multi!) */}
      {step === 2 && (
        <div>
          {/* Spaces summary bar */}
          <div style={{ background: "linear-gradient(135deg, #FFF5F7, #F3E8FF, #EFF6FF)", borderRadius: 14, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#333" }}>{spaces.length} space{spaces.length > 1 ? "s" : ""}</span>
              <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>
                {getJobEmojis(spaces)}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#7C3AED" }}>
              {totalHours}h • {formatCurrency(totalCost)}
            </div>
          </div>

          {spaces.map((space, index) => (
            <SpaceEditorCard
              key={space.id}
              space={space}
              index={index}
              total={spaces.length}
              onUpdate={(updated) => updateSpace(index, updated)}
              onRemove={() => removeSpace(index)}
              collapsed={expandedSpace !== index}
              onToggle={() => setExpandedSpace(expandedSpace === index ? -1 : index)}
            />
          ))}

          <button onClick={addSpace} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "2px dashed #C084FC", background: "linear-gradient(135deg, #FAF5FF, #FFF5F7)", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}>
            ➕ Add Another Space
          </button>

          <TextArea label="General Job Notes" placeholder="Any overall notes for this job?" value={form.notes} onChange={(e) => update("notes", e.target.value)} style={{ marginTop: 14 }} />
        </div>
      )}

      {/* Step 3: Scheduling */}
      {step === 3 && (
        <div>
          <Card style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 8, display: "block" }}>Client's Available Days</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {DAYS_OF_WEEK.map((d) => (
                <button key={d} onClick={() => { const arr = form.preferredDays.includes(d) ? form.preferredDays.filter(x => x !== d) : [...form.preferredDays, d]; update("preferredDays", arr); }} style={{ padding: "8px 12px", borderRadius: 10, border: form.preferredDays.includes(d) ? "2px solid #34D399" : "2px solid #E5E7EB", background: form.preferredDays.includes(d) ? "#ECFDF5" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: form.preferredDays.includes(d) ? "#059669" : "#666" }}>
                  {d}
                </button>
              ))}
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 8, display: "block" }}>Preferred Times</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {TIME_SLOTS.map((t) => (
                <button key={t} onClick={() => { const arr = form.preferredTimes.includes(t) ? form.preferredTimes.filter(x => x !== t) : [...form.preferredTimes, t]; update("preferredTimes", arr); }} style={{ padding: "8px 12px", borderRadius: 10, border: form.preferredTimes.includes(t) ? "2px solid #60A5FA" : "2px solid #E5E7EB", background: form.preferredTimes.includes(t) ? "#EFF6FF" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: form.preferredTimes.includes(t) ? "#2563EB" : "#666" }}>
                  {t}
                </button>
              ))}
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 8, display: "block" }}>Days That DON'T Work</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {DAYS_OF_WEEK.map((d) => (
                <button key={`block-${d}`} onClick={() => { const arr = form.blockedDays.includes(d) ? form.blockedDays.filter(x => x !== d) : [...form.blockedDays, d]; update("blockedDays", arr); }} style={{ padding: "8px 12px", borderRadius: 10, border: form.blockedDays.includes(d) ? "2px solid #FB7185" : "2px solid #E5E7EB", background: form.blockedDays.includes(d) ? "#FFF1F2" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: form.blockedDays.includes(d) ? "#E11D48" : "#666" }}>
                  ❌ {d}
                </button>
              ))}
            </div>
          </Card>

          {/* Multi-day schedule builder */}
          <Card>
            <ScheduleDaysEditor
              scheduleDays={form.scheduleDays}
              totalHours={totalHours}
              onChange={(days) => update("scheduleDays", days)}
            />
          </Card>
        </div>
      )}

      {/* Step 4: Estimate */}
      {step === 4 && (
        <Card>
          <Select label="Payment Method" value={form.paymentMethod} onChange={(e) => update("paymentMethod", e.target.value)} options={[
            { value: "cash", label: "💵 Cash (no tax)" },
            { value: "card", label: "💳 Credit/Debit Card" },
            { value: "venmo", label: "📱 Venmo" },
            { value: "zelle", label: "🏦 Zelle" },
            { value: "stripe", label: "💳 Stripe" },
          ]} />
          <Select label="Discount" value={form.discountType} onChange={(e) => update("discountType", e.target.value)} options={[
            { value: "none", label: "No discount" },
            { value: "percent", label: "% Discount" },
            { value: "dollar", label: "$ Discount" },
          ]} />
          {form.discountType !== "none" && (
            <Input label={form.discountType === "percent" ? "Discount %" : "Discount $"} type="number" min="0" value={form.discountValue} onChange={(e) => update("discountValue", parseFloat(e.target.value) || 0)} />
          )}

          {/* Breakdown */}
          <div style={{ background: "linear-gradient(135deg, #FFF5F7, #F3E8FF, #EFF6FF)", borderRadius: 16, padding: 16, marginTop: 8 }}>
            <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💎 Estimate Breakdown</h4>
            
            {/* Per-space breakdown */}
            {spaces.map((s, i) => {
              const emoji = SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦";
              const hrs = s.estimatedHours || estimateSpaceHours(s.spaceType, s.size, s.clutterLevel);
              return (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, padding: "4px 0", borderBottom: i < spaces.length - 1 ? "1px solid rgba(192,132,252,0.15)" : "none" }}>
                  <span style={{ color: "#666" }}>{emoji} {s.spaceType} ({hrs}h)</span>
                  <span style={{ fontWeight: 600 }}>{formatCurrency(hrs * settings.hourlyRate)}</span>
                </div>
              );
            })}

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8, paddingTop: 8, borderTop: "1.5px solid rgba(192,132,252,0.2)" }}>
              <span style={{ color: "#666" }}>Subtotal ({totalHours}h × {formatCurrency(settings.hourlyRate)}/hr)</span>
              <span style={{ fontWeight: 700 }}>{formatCurrency(totalCost)}</span>
            </div>

            {form.discountType !== "none" && form.discountValue > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#E11D48", marginTop: 4 }}>
                <span>Discount ({form.discountType === "percent" ? `${form.discountValue}%` : formatCurrency(form.discountValue)})</span>
                <span>-{formatCurrency(form.discountType === "percent" ? totalCost * form.discountValue / 100 : form.discountValue)}</span>
              </div>
            )}
            {form.paymentMethod !== "cash" && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginTop: 4 }}>
                <span>WA Sales Tax (10.25%)</span>
                <span>+{formatCurrency((totalCost - (form.discountType === "percent" ? totalCost * form.discountValue / 100 : form.discountType === "dollar" ? form.discountValue : 0)) * WA_TAX_RATE)}</span>
              </div>
            )}
            <div style={{ borderTop: "2px solid rgba(192,132,252,0.25)", paddingTop: 10, marginTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 800, fontFamily: "'Outfit', sans-serif", fontSize: 16 }}>Total</span>
              <span style={{ fontWeight: 800, fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#7C3AED" }}>{formatCurrency(calculateTotal())}</span>
            </div>
          </div>
        </Card>
      )}

      {/* Nav buttons */}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        {step > 1 && <GradientButton variant="secondary" onClick={() => setStep(step - 1)} style={{ flex: 1 }}>← Back</GradientButton>}
        {step < totalSteps ? (
          <GradientButton onClick={() => setStep(step + 1)} style={{ flex: 1 }}>Next →</GradientButton>
        ) : (
          <GradientButton variant="success" onClick={handleSave} style={{ flex: 1 }}>✨ Create Job</GradientButton>
        )}
      </div>
    </div>
  );
}

// ─── Job Detail ───
function JobDetail({ job, updateJob, settings, showToast, setCurrentView }) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [expandedSpace, setExpandedSpace] = useState(-1);

  if (!job) return <Card><p>Job not found</p></Card>;

  const spaces = job.spaces || [];

  const updateSpace = (index, updated) => {
    const newSpaces = [...spaces];
    newSpaces[index] = updated;
    const newHours = totalSpacesHours(newSpaces);
    updateJob(job.id, { spaces: newSpaces, estimatedHours: newHours, estimatedCost: newHours * settings.hourlyRate });
  };

  const addSpaceToJob = () => {
    const newSpace = createEmptySpace();
    const newSpaces = [...spaces, newSpace];
    const newHours = totalSpacesHours(newSpaces);
    updateJob(job.id, { spaces: newSpaces, estimatedHours: newHours, estimatedCost: newHours * settings.hourlyRate });
    setExpandedSpace(newSpaces.length - 1);
    showToast("Space added! 🏠");
  };

  const removeSpaceFromJob = (index) => {
    if (spaces.length <= 1) return;
    const newSpaces = spaces.filter((_, i) => i !== index);
    const newHours = totalSpacesHours(newSpaces);
    updateJob(job.id, { spaces: newSpaces, estimatedHours: newHours, estimatedCost: newHours * settings.hourlyRate });
    showToast("Space removed");
  };

  const startTimer = () => {
    updateJob(job.id, { actualStartTime: new Date().toISOString(), status: "in-progress" });
    showToast("Timer started! ⏱️");
  };

  const stopTimer = () => {
    const end = new Date().toISOString();
    const hours = Math.round((new Date(end) - new Date(job.actualStartTime)) / 3600000 * 10) / 10;
    updateJob(job.id, { actualEndTime: end, actualHours: hours, status: "completed" });
    showToast(`Done! ${hours}h logged ✅`);
  };

  const generateInvoice = () => {
    let base = (job.actualHours || job.estimatedHours) * settings.hourlyRate;
    if (job.discountType === "percent") base -= base * (job.discountValue / 100);
    else if (job.discountType === "dollar") base -= job.discountValue;
    if (job.paymentMethod !== "cash") base += base * WA_TAX_RATE;
    updateJob(job.id, { invoiceAmount: Math.max(0, base), status: "invoiced" });
    showToast("Invoice generated! 🧾");
  };

  const markPaid = () => {
    updateJob(job.id, { finalAmount: job.invoiceAmount, status: "paid", paidAt: new Date().toISOString() });
    showToast("Payment received! 💰");
  };

  const saveFeedback = () => {
    updateJob(job.id, { feedback: { rating: feedbackRating, text: feedbackText, date: new Date().toISOString() } });
    setShowFeedback(false);
    showToast("Feedback saved! 🌟");
  };

  const generateICS = (jobData) => {
    const days = (jobData.scheduleDays || []).filter(d => d.date);
    if (days.length === 0 && jobData.scheduledDate) {
      days.push({ id: "legacy", date: jobData.scheduledDate, startTime: jobData.scheduledTime || "09:00", hours: jobData.estimatedHours || 2 });
    }
    const spacesDesc = (jobData.spaces || []).map(s => `${s.spaceType} (${s.size}, ${s.clutterLevel})`).join(", ");
    const location = jobData.clientAddress || "";
    const events = days.map((day, i) => {
      const date = day.date.replace(/-/g, "");
      const time = day.startTime ? day.startTime.replace(":", "") + "00" : "090000";
      const endHour = parseInt(time.substring(0, 2)) + Math.ceil(day.hours || 2);
      const endTime = String(Math.min(endHour, 23)).padStart(2, "0") + time.substring(2);
      const dayLabel = days.length > 1 ? ` (Day ${i + 1}/${days.length} — ${day.hours}h)` : "";
      const summary = `✨ SparkleSpace: ${jobData.clientName} - ${getJobSummary(jobData.spaces)}${dayLabel}`;
      const description = `SparkleSpace Job for ${jobData.clientName}${dayLabel}\\nSpaces: ${spacesDesc}\\nHours this day: ${day.hours}h\\nTotal estimated: ${jobData.estimatedHours}h\\nAddress: ${jobData.clientAddress || "TBD"}\\nPhone: ${jobData.clientPhone || "N/A"}`;
      return [
        "BEGIN:VEVENT",
        `DTSTART:${date}T${time}`,
        `DTEND:${date}T${endTime}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        `LOCATION:${location}`,
        "STATUS:CONFIRMED",
        `UID:${jobData.id}-day${i}@sparklespace`,
        "END:VEVENT",
      ].join("\r\n");
    });

    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SparkleSpace//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...events,
      "END:VCALENDAR",
    ].join("\r\n");
  };

  // ─── Client Approval Workflow (EmailJS) ───
  const [sending, setSending] = useState(false);

  const sendAssessmentToClient = async () => {
    if (!job.clientEmail) return showToast("No client email! Add one first", "error");
    setSending(true);
    try {
      const spacesHTML = (job.spaces || []).map(s => {
        const emoji = SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦";
        return `${emoji} <strong>${s.spaceType}</strong> (${s.size}, ${s.clutterLevel}) — ${s.estimatedHours}h`;
      }).join("<br>");

      let costLines = `${job.estimatedHours}h × ${formatCurrency(settings.hourlyRate)}/hr = <strong>${formatCurrency(job.estimatedCost)}</strong>`;
      if (job.discountType !== "none" && job.discountValue > 0) {
        costLines += `<br>Discount: ${job.discountType === "percent" ? `${job.discountValue}%` : formatCurrency(job.discountValue)}`;
      }
      if (job.paymentMethod !== "cash") costLines += `<br>WA Sales Tax (10.25%) applies for ${job.paymentMethod} payments`;
      costLines += `<br><strong style="font-size:16px;color:#7C3AED;">Estimated Total: ${formatCurrency(job.totalEstimate || job.estimatedCost)}</strong>`;

      const html = buildEmailHTML({
        greeting: `Hi ${job.clientName}! 👋`,
        sections: [
          { title: "📋 Spaces to Organize", content: spacesHTML },
          { title: "💰 Cost Estimate", content: costLines },
          ...(job.notes ? [{ title: "📝 Notes", content: job.notes }] : []),
        ],
        cta: '👉 Reply to this email with "APPROVED" to confirm!',
        footer: `Questions? Call or text me anytime.<br><br>✨ Thea<br>SparkleSpace Organization<br>📱 ${THEA_PHONE}`,
      });

      await sendEmail({
        to: job.clientEmail,
        cc: THEA_EMAIL,
        subject: `✨ SparkleSpace Assessment for ${job.clientName}`,
        htmlBody: html,
        settings,
      });
      updateJob(job.id, { status: "estimate-sent", estimateSentAt: new Date().toISOString() });
      showToast("Assessment emailed to client! 📧");
    } catch (err) {
      if (err.message === "EMAIL_NOT_CONFIGURED") {
        showToast("Set up EmailJS in Settings first!", "error");
      } else if (err.message?.includes("Failed to load EmailJS")) {
        showToast("Email blocked here — deploy to Netlify first!", "error");
      } else {
        console.error("Email error:", err);
        showToast("Email failed: " + (err?.text || err?.message || "unknown error"), "error");
      }
    }
    setSending(false);
  };

  const markEstimateApproved = () => {
    updateJob(job.id, { status: "estimate-approved", estimateApprovedAt: new Date().toISOString() });
    showToast("Client approved the estimate! ✅");
  };

  const sendScheduleToClient = async () => {
    const days = (job.scheduleDays || []).filter(d => d.date);
    if (days.length === 0) return showToast("Add schedule days first!", "error");
    if (!job.clientEmail) return showToast("No client email!", "error");
    setSending(true);
    try {
      const daysHTML = days.map((d, i) =>
        `<strong>Day ${i + 1}:</strong> ${formatDate(d.date)} at ${d.startTime || "TBD"} — ${d.hours}h`
      ).join("<br>");
      const spacesText = (job.spaces || []).map(s => {
        const emoji = SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦";
        return `${emoji} ${s.spaceType}`;
      }).join(", ");

      const html = buildEmailHTML({
        greeting: `Hi ${job.clientName}! 🎉`,
        sections: [
          { title: "📋 Spaces", content: spacesText },
          { title: "📅 Proposed Schedule", content: daysHTML },
          { title: "💰 Estimated Total", content: `<strong style="font-size:16px;color:#7C3AED;">${formatCurrency(job.totalEstimate || job.estimatedCost)}</strong> (${job.estimatedHours}h total)` },
        ],
        cta: '👉 Reply with "CONFIRMED" to book these times!<br><span style="font-size:12px;font-weight:400;">Need different times? Just let me know.</span>',
      });

      await sendEmail({
        to: job.clientEmail,
        cc: THEA_EMAIL,
        subject: `📅 SparkleSpace Schedule for ${job.clientName}`,
        htmlBody: html,
        settings,
      });
      updateJob(job.id, { status: "schedule-sent", scheduleSentAt: new Date().toISOString() });
      showToast("Schedule emailed to client! 📅");
    } catch (err) {
      if (err.message === "EMAIL_NOT_CONFIGURED") showToast("Set up EmailJS in Settings first!", "error");
      else if (err.message?.includes("Failed to load EmailJS")) showToast("Email blocked here — deploy to Netlify first!", "error");
      else { console.error(err); showToast("Email failed: " + (err?.text || err?.message || "unknown"), "error"); }
    }
    setSending(false);
  };

  const markScheduleAccepted = async () => {
    const days = (job.scheduleDays || []).filter(d => d.date);
    setSending(true);
    try {
      // Send calendar invite email to client
      const daysHTML = days.map((d, i) =>
        `<strong>Day ${i + 1}:</strong> ${formatDate(d.date)} at ${d.startTime || "TBD"} — ${d.hours}h`
      ).join("<br>");
      const spacesText = (job.spaces || []).map(s => s.spaceType).join(", ");

      const clientHTML = buildEmailHTML({
        greeting: `Hi ${job.clientName}! 🎉`,
        sections: [
          { title: "✅ Your Session is Booked!", content: `Your SparkleSpace organizing session is officially confirmed.` },
          { title: "📋 Spaces", content: spacesText },
          { title: "📅 Confirmed Schedule", content: daysHTML },
          { title: "💰 Estimated Total", content: `<strong style="font-size:16px;color:#7C3AED;">${formatCurrency(job.totalEstimate || job.estimatedCost)}</strong>` },
        ],
        cta: `See you on ${days[0] ? formatDate(days[0].date) : "the scheduled date"}! 🌟`,
      });

      await sendEmail({
        to: job.clientEmail,
        cc: THEA_EMAIL,
        subject: `🎉 SparkleSpace Session Confirmed — ${job.clientName}`,
        htmlBody: clientHTML,
        settings,
      });

      updateJob(job.id, { status: "scheduled", scheduleAcceptedAt: new Date().toISOString() });

      // Also download .ics for Thea's calendar
      const icsContent = generateICS(job);
      const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sparklespace-${job.clientName.replace(/\s+/g, "-").toLowerCase()}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast("Confirmed! 🎉 Email sent & .ics downloaded");
    } catch (err) {
      if (err.message === "EMAIL_NOT_CONFIGURED") showToast("Set up EmailJS in Settings first!", "error");
      else if (err.message?.includes("Failed to load EmailJS")) showToast("Email blocked here — deploy to Netlify first!", "error");
      else { console.error(err); showToast("Email failed: " + (err?.text || err?.message || "unknown"), "error"); }
    }
    setSending(false);
  };

  const accuracyDiff = job.actualHours && job.estimatedHours ? Math.round((job.actualHours - job.estimatedHours) * 10) / 10 : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <button onClick={() => setCurrentView("jobs")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#C084FC", textAlign: "left", padding: 0 }}>← Back to Jobs</button>

      {/* Header */}
      <Card style={{ background: "linear-gradient(135deg, #FFF5F7, #F3E8FF)", border: "1px solid #E8D5FF" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>{job.clientName}</h2>
            <p style={{ fontSize: 13, color: "#888", margin: 0 }}>{getJobEmojis(spaces)} {getJobSummary(spaces)} • {job.clientAddress || "No address"}</p>
            {job.clientPhone && <p style={{ fontSize: 12, color: "#A855F7", margin: "4px 0 0", fontWeight: 600 }}>📱 {job.clientPhone}</p>}
          </div>
          <StatusBadge status={job.status} />
        </div>
        {/* Space chips */}
        {spaces.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {spaces.map(s => (
              <span key={s.id} style={{ fontSize: 11, background: "rgba(192,132,252,0.15)", color: "#7C3AED", padding: "3px 10px", borderRadius: 10, fontWeight: 600 }}>
                {SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji} {s.spaceType} • {s.estimatedHours || estimateSpaceHours(s.spaceType, s.size, s.clutterLevel)}h
              </span>
            ))}
          </div>
        )}
        {/* Schedule days display */}
        {job.scheduleDays && job.scheduleDays.filter(d => d.date).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 4 }}>📅 Schedule ({job.scheduleDays.filter(d => d.date).length} day{job.scheduleDays.filter(d => d.date).length !== 1 ? "s" : ""})</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {job.scheduleDays.filter(d => d.date).map((d, i) => (
                <span key={d.id || i} style={{ fontSize: 10, background: "#EFF6FF", color: "#2563EB", padding: "3px 8px", borderRadius: 8, fontWeight: 600 }}>
                  {formatDate(d.date)} {d.startTime ? `${d.startTime}` : ""} • {d.hours}h
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Time & Cost */}
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>⏱️ Time & Cost</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: "#FFF5F7", borderRadius: 12, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>Estimated</div>
            <div style={{ fontWeight: 800, color: "#FF6B9D", fontSize: 16 }}>{job.estimatedHours}h</div>
            <div style={{ fontSize: 11, color: "#888" }}>{formatCurrency(job.estimatedCost)}</div>
          </div>
          <div style={{ background: "#F3E8FF", borderRadius: 12, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>Actual</div>
            <div style={{ fontWeight: 800, color: "#7C3AED", fontSize: 16 }}>{job.actualHours ? `${job.actualHours}h` : "—"}</div>
            {job.actualHours && <div style={{ fontSize: 11, color: "#888" }}>{formatCurrency(job.actualHours * settings.hourlyRate)}</div>}
          </div>
        </div>
        {accuracyDiff !== null && (
          <div style={{ marginTop: 8, padding: 8, borderRadius: 10, background: accuracyDiff > 0 ? "#FFF1F2" : "#ECFDF5", textAlign: "center", fontSize: 12, fontWeight: 600, color: accuracyDiff > 0 ? "#E11D48" : "#059669" }}>
            {accuracyDiff > 0 ? `⚠️ Took ${accuracyDiff}h longer than estimated` : accuracyDiff < 0 ? `✅ Finished ${Math.abs(accuracyDiff)}h early!` : "✅ Right on time!"}
          </div>
        )}
      </Card>

      {/* Spaces (editable) */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: 0 }}>🏠 Spaces ({spaces.length})</h3>
          <button onClick={addSpaceToJob} style={{ background: "linear-gradient(135deg, #F3E8FF, #FFF5F7)", border: "1.5px solid #D8B4FE", borderRadius: 10, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: "#7C3AED", cursor: "pointer" }}>
            + Add Space
          </button>
        </div>
        {spaces.map((space, index) => (
          <SpaceEditorCard
            key={space.id}
            space={space}
            index={index}
            total={spaces.length}
            onUpdate={(updated) => updateSpace(index, updated)}
            onRemove={() => removeSpaceFromJob(index)}
            collapsed={expandedSpace !== index}
            onToggle={() => setExpandedSpace(expandedSpace === index ? -1 : index)}
          />
        ))}
      </Card>

      {/* After Photos (per-space) */}
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📸 After Photos</h3>
        {spaces.map((space, index) => (
          <div key={space.id} style={{ marginBottom: 10 }}>
            <PhotoUpload
              label={`${SPACE_TYPES.find(t => t.label === space.spaceType)?.emoji || "📦"} ${space.spaceType} — After`}
              photos={space.afterPhotos || []}
              onPhotosChange={(p) => {
                const updated = { ...space, afterPhotos: p };
                updateSpace(index, updated);
              }}
            />
          </div>
        ))}
      </Card>

      {/* Notes */}
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📝 Job Notes</h3>
        <TextArea value={job.notes || ""} onChange={(e) => updateJob(job.id, { notes: e.target.value })} placeholder="Add job notes..." />
      </Card>

      {/* Actions */}
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>⚡ Actions</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Step 1: Assessment — finalize estimate then send to client */}
          {job.status === "assessment" && (
            <>
              <div style={{ background: "linear-gradient(135deg, #FFF8E1, #FFF3E0)", borderRadius: 12, padding: 10, marginBottom: 4, fontSize: 12, color: "#E65100", fontWeight: 600 }}>
                📋 Finalize your assessment, then send it to the client for approval
              </div>
              <GradientButton onClick={sendAssessmentToClient} style={{ opacity: sending ? 0.6 : 1, pointerEvents: sending ? "none" : "auto" }}>
                {sending ? "⏳ Sending..." : "📧 Send Assessment to Client"}
              </GradientButton>
            </>
          )}

          {/* Step 2: Estimate sent — waiting for client approval */}
          {job.status === "estimate-sent" && (
            <>
              <div style={{ background: "#FFF8E1", borderRadius: 12, padding: 12, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>⏳</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#F57F17" }}>Waiting for Client Approval</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Sent {job.estimateSentAt ? formatDate(job.estimateSentAt) : ""}</div>
                {job.clientEmail && <div style={{ fontSize: 11, color: "#A855F7", marginTop: 2 }}>📧 {job.clientEmail}</div>}
              </div>
              <GradientButton variant="success" onClick={markEstimateApproved}>✅ Client Approved!</GradientButton>
              <GradientButton variant="secondary" onClick={sendAssessmentToClient} style={{ fontSize: 12, opacity: sending ? 0.6 : 1, pointerEvents: sending ? "none" : "auto" }}>
                {sending ? "⏳ Sending..." : "📧 Resend Assessment"}
              </GradientButton>
            </>
          )}

          {/* Step 3: Estimate approved — set up schedule then send to client */}
          {job.status === "estimate-approved" && (
            <>
              <div style={{ background: "#E8F5E9", borderRadius: 12, padding: 10, marginBottom: 4, fontSize: 12, color: "#2E7D32", fontWeight: 600 }}>
                ✅ Client approved the estimate! Now set up the schedule and send it.
              </div>
              <ScheduleDaysEditor
                scheduleDays={job.scheduleDays || []}
                totalHours={job.estimatedHours || 0}
                onChange={(days) => {
                  const sorted = [...days].filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
                  updateJob(job.id, { scheduleDays: sorted, scheduledDate: sorted[0]?.date || "", scheduledTime: sorted[0]?.startTime || "" });
                }}
              />
              <GradientButton onClick={sendScheduleToClient} style={{ opacity: sending ? 0.6 : 1, pointerEvents: sending ? "none" : "auto" }}>
                {sending ? "⏳ Sending..." : "📅 Send Schedule to Client"}
              </GradientButton>
            </>
          )}

          {/* Step 4: Schedule sent — waiting for client to accept */}
          {job.status === "schedule-sent" && (
            <>
              <div style={{ background: "#E1F5FE", borderRadius: 12, padding: 12, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>📅</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0277BD" }}>Waiting for Schedule Confirmation</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Sent {job.scheduleSentAt ? formatDate(job.scheduleSentAt) : ""}</div>
                {(job.scheduleDays || []).filter(d => d.date).map((d, i) => (
                  <div key={d.id || i} style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                    Day {i + 1}: {formatDate(d.date)} • {d.startTime || "TBD"} • {d.hours}h
                  </div>
                ))}
              </div>
              <GradientButton variant="success" onClick={markScheduleAccepted} style={{ opacity: sending ? 0.6 : 1, pointerEvents: sending ? "none" : "auto" }}>
                {sending ? "⏳ Sending..." : "🎉 Client Confirmed! Send Calendar Invites"}
              </GradientButton>
              <GradientButton variant="secondary" onClick={() => { updateJob(job.id, { status: "estimate-approved" }); showToast("Back to scheduling"); }} style={{ fontSize: 12 }}>✏️ Edit Schedule & Resend</GradientButton>
            </>
          )}

          {/* Step 5: Scheduled — ready to work */}
          {job.status === "scheduled" && !job.actualStartTime && (
            <>
              <div style={{ background: "#E3F2FD", borderRadius: 12, padding: 10, marginBottom: 4, fontSize: 12, color: "#1565C0", fontWeight: 600 }}>
                🎉 Client confirmed! Ready to organize.
              </div>
              <GradientButton variant="success" onClick={startTimer}>⏱️ Start Timer</GradientButton>
            </>
          )}

          {/* Step 6: In progress */}
          {job.status === "in-progress" && job.actualStartTime && !job.actualEndTime && (
            <>
              <div style={{ background: "#FFF5F7", borderRadius: 12, padding: 12, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>Started at</div>
                <div style={{ fontWeight: 800, color: "#FF6B9D", fontSize: 16 }}>{formatTime(job.actualStartTime)}</div>
                <TimerDisplay startTime={job.actualStartTime} />
              </div>
              <GradientButton variant="danger" onClick={stopTimer}>⏹️ Stop Timer</GradientButton>
            </>
          )}

          {/* Step 7: Completed */}
          {job.status === "completed" && (
            <GradientButton onClick={generateInvoice}>🧾 Generate Invoice</GradientButton>
          )}

          {/* Step 8: Invoiced */}
          {job.status === "invoiced" && (
            <>
              <div style={{ background: "#F3E8FF", borderRadius: 12, padding: 12, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>Invoice Amount</div>
                <div style={{ fontWeight: 800, color: "#7C3AED", fontSize: 22 }}>{formatCurrency(job.invoiceAmount)}</div>
                <div style={{ fontSize: 11, color: "#888" }}>via {job.paymentMethod}</div>
              </div>
              <GradientButton variant="success" onClick={markPaid}>💰 Mark as Paid</GradientButton>
            </>
          )}

          {/* Step 9: Paid — collect feedback */}
          {job.status === "paid" && !job.feedback && (
            <GradientButton onClick={() => setShowFeedback(true)}>🌟 Collect Feedback</GradientButton>
          )}
          {job.feedback && (
            <div style={{ background: "#ECFDF5", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#059669", marginBottom: 4 }}>Client Feedback</div>
              <div style={{ fontSize: 16, marginBottom: 4 }}>{"⭐".repeat(job.feedback.rating)}</div>
              <div style={{ fontSize: 13, color: "#333" }}>{job.feedback.text || "No comment"}</div>
            </div>
          )}

          {/* Workflow progress tracker */}
          <div style={{ marginTop: 8, background: "#FDFBFF", borderRadius: 12, padding: 12, border: "1px solid #F0E6FF" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 8 }}>📍 Workflow</div>
            <div style={{ display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
              {[
                { key: "assessment", label: "Assess", emoji: "📋" },
                { key: "estimate-sent", label: "Sent", emoji: "📧" },
                { key: "estimate-approved", label: "Approved", emoji: "✅" },
                { key: "schedule-sent", label: "Schedule", emoji: "📅" },
                { key: "scheduled", label: "Confirmed", emoji: "🎉" },
                { key: "in-progress", label: "Working", emoji: "⏱️" },
                { key: "completed", label: "Done", emoji: "✨" },
                { key: "invoiced", label: "Invoiced", emoji: "🧾" },
                { key: "paid", label: "Paid", emoji: "💰" },
              ].map((s, i, arr) => {
                const statusOrder = arr.map(x => x.key);
                const currentIdx = statusOrder.indexOf(job.status);
                const thisIdx = statusOrder.indexOf(s.key);
                const isDone = thisIdx < currentIdx;
                const isCurrent = thisIdx === currentIdx;
                return (
                  <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, background: isCurrent ? "linear-gradient(135deg, #FF6B9D, #C084FC)" : isDone ? "#34D399" : "#E5E7EB", color: isCurrent || isDone ? "#fff" : "#999", fontWeight: 700 }}>
                      {isDone ? "✓" : s.emoji}
                    </div>
                    {i < arr.length - 1 && <div style={{ width: 10, height: 2, background: isDone ? "#34D399" : "#E5E7EB", borderRadius: 1 }} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Feedback Modal */}
      {showFeedback && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <Card style={{ width: "100%", maxWidth: 400 }}>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 800, margin: "0 0 14px" }}>🌟 Client Feedback</h3>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 8, display: "block" }}>Rating</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setFeedbackRating(n)} style={{ fontSize: 28, background: "none", border: "none", cursor: "pointer", opacity: n <= feedbackRating ? 1 : 0.3, transition: "all 0.2s" }}>⭐</button>
              ))}
            </div>
            <TextArea label="Comments" placeholder="How was the service?" value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <GradientButton variant="secondary" onClick={() => setShowFeedback(false)} style={{ flex: 1 }}>Cancel</GradientButton>
              <GradientButton variant="success" onClick={saveFeedback} style={{ flex: 1 }}>Save ✨</GradientButton>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function TimerDisplay({ startTime }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => { setElapsed(Math.floor((Date.now() - new Date(startTime).getTime()) / 1000)); }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return (
    <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, fontWeight: 800, color: "#FF6B9D", marginTop: 4, letterSpacing: 2 }}>
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </div>
  );
}

// ─── Calendar ───
function CalendarView({ data, openJob }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const scheduledJobs = data.jobs.filter(j => j.scheduledDate || (j.scheduleDays && j.scheduleDays.length > 0));
  const getJobsForDay = (day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const results = [];
    scheduledJobs.forEach(j => {
      const days = (j.scheduleDays || []).filter(d => d.date);
      if (days.length > 0) {
        const matchDay = days.find(d => d.date === dateStr);
        if (matchDay) results.push({ ...j, _dayInfo: matchDay });
      } else if (j.scheduledDate === dateStr) {
        results.push(j);
      }
    });
    return results;
  };
  const isToday = (day) => { const t = new Date(); return day === t.getDate() && month === t.getMonth() && year === t.getFullYear(); };
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={() => setCurrentMonth(new Date(year, month - 1))} style={{ background: "#F3E8FF", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontWeight: 700, color: "#7C3AED" }}>‹</button>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 800, margin: 0 }}>📅 {monthName}</h2>
        <button onClick={() => setCurrentMonth(new Date(year, month + 1))} style={{ background: "#F3E8FF", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontWeight: 700, color: "#7C3AED" }}>›</button>
      </div>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
            <div key={d} style={{ fontSize: 10, fontWeight: 700, color: "#999", padding: "6px 0" }}>{d}</div>
          ))}
          {days.map((day, i) => {
            if (!day) return <div key={`e-${i}`} />;
            const jobs = getJobsForDay(day);
            const today = isToday(day);
            return (
              <div key={day} style={{ padding: "6px 2px", borderRadius: 10, minHeight: 44, background: today ? "linear-gradient(135deg, #FF6B9D, #C084FC)" : jobs.length ? "#F3E8FF" : "transparent", cursor: jobs.length ? "pointer" : "default" }} onClick={() => { if (jobs.length) openJob(jobs[0].id); }}>
                <div style={{ fontSize: 12, fontWeight: today ? 800 : 500, color: today ? "#fff" : "#333" }}>{day}</div>
                {jobs.slice(0, 2).map((j, idx) => (
                  <div key={idx} style={{ fontSize: 7, background: today ? "rgba(255,255,255,0.3)" : "#C084FC", color: "#fff", borderRadius: 4, padding: "1px 3px", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                    {j.clientName.split(" ")[0]}
                  </div>
                ))}
                {jobs.length > 2 && <div style={{ fontSize: 7, color: today ? "#fff" : "#A855F7", fontWeight: 700 }}>+{jobs.length - 2}</div>}
              </div>
            );
          })}
        </div>
      </Card>
      <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, color: "#333", margin: "16px 0 10px" }}>📋 This Month's Jobs</h3>
      {(() => {
        // Build a flat list of (job, dayInfo) for this month
        const entries = [];
        scheduledJobs.forEach(job => {
          const days = (job.scheduleDays || []).filter(d => d.date);
          if (days.length > 0) {
            days.forEach((d, i) => {
              const dt = new Date(d.date);
              if (dt.getMonth() === month && dt.getFullYear() === year) {
                entries.push({ job, dayInfo: d, dayIndex: i, totalDays: days.length });
              }
            });
          } else if (job.scheduledDate) {
            const dt = new Date(job.scheduledDate);
            if (dt.getMonth() === month && dt.getFullYear() === year) {
              entries.push({ job, dayInfo: null, dayIndex: 0, totalDays: 1 });
            }
          }
        });
        entries.sort((a, b) => (a.dayInfo?.date || a.job.scheduledDate).localeCompare(b.dayInfo?.date || b.job.scheduledDate));
        return entries.map((entry, idx) => (
          <Card key={`${entry.job.id}-${idx}`} onClick={() => openJob(entry.job.id)} style={{ padding: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {entry.job.clientName}
                  {entry.totalDays > 1 && <span style={{ fontSize: 10, color: "#A855F7", fontWeight: 600, marginLeft: 6 }}>Day {entry.dayIndex + 1}/{entry.totalDays}</span>}
                </div>
                <div style={{ fontSize: 11, color: "#888" }}>
                  {getJobEmojis(entry.job.spaces)} {getJobSummary(entry.job.spaces)} • {formatDate(entry.dayInfo?.date || entry.job.scheduledDate)}
                  {entry.dayInfo?.startTime ? ` • ${entry.dayInfo.startTime}` : ""}
                  {entry.dayInfo?.hours ? ` • ${entry.dayInfo.hours}h` : ""}
                </div>
              </div>
              <StatusBadge status={entry.job.status} />
            </div>
          </Card>
        ));
      })()}
    </div>
  );
}

// ─── Analytics ───
function Analytics({ data }) {
  const paid = data.jobs.filter(j => j.status === "paid");
  const completed = data.jobs.filter(j => ["completed", "paid"].includes(j.status));
  const totalRevenue = paid.reduce((s, j) => s + (j.finalAmount || 0), 0);
  const totalHours = completed.reduce((s, j) => s + (j.actualHours || j.estimatedHours || 0), 0);
  const avgRating = completed.filter(j => j.feedback?.rating).reduce((s, j, _, arr) => s + j.feedback.rating / arr.length, 0);
  const estimateAccuracy = completed.filter(j => j.actualHours && j.estimatedHours);
  const avgDiff = estimateAccuracy.length ? estimateAccuracy.reduce((s, j) => s + Math.abs(j.actualHours - j.estimatedHours), 0) / estimateAccuracy.length : 0;

  // Revenue by space type (across all spaces in all paid jobs)
  const revenueByType = {};
  paid.forEach(j => {
    (j.spaces || []).forEach(s => {
      const hrs = s.estimatedHours || estimateSpaceHours(s.spaceType, s.size, s.clutterLevel);
      const spaceCost = hrs * (data.settings?.hourlyRate || DEFAULT_RATE);
      revenueByType[s.spaceType] = (revenueByType[s.spaceType] || 0) + spaceCost;
    });
  });

  // Spaces count
  const totalSpaces = data.jobs.reduce((s, j) => s + (j.spaces?.length || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 800, margin: 0 }}>📊 Your Stats</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Total Revenue", value: formatCurrency(totalRevenue), emoji: "💰", color: "#34D399" },
          { label: "Total Hours", value: `${Math.round(totalHours * 10) / 10}h`, emoji: "⏱️", color: "#60A5FA" },
          { label: "Jobs Done", value: completed.length, emoji: "✅", color: "#C084FC" },
          { label: "Spaces Done", value: totalSpaces, emoji: "🏠", color: "#FF6B9D" },
          { label: "Avg Rating", value: avgRating ? `${avgRating.toFixed(1)} ⭐` : "—", emoji: "🌟", color: "#F59E0B" },
          { label: "Avg Accuracy", value: avgDiff ? `±${avgDiff.toFixed(1)}h` : "—", emoji: "🎯", color: "#8B5CF6" },
        ].map((s) => (
          <Card key={s.label} style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>{s.emoji}</div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#999", fontWeight: 600 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Accuracy */}
      {estimateAccuracy.length > 0 && (
        <Card>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>🎯 Estimate Accuracy</h3>
          {estimateAccuracy.map(j => (
            <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #F3F4F6", fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{j.clientName}</span>
              <span>Est: {j.estimatedHours}h → Actual: {j.actualHours}h</span>
              <span style={{ fontWeight: 700, color: j.actualHours > j.estimatedHours ? "#DC2626" : "#059669" }}>
                {j.actualHours > j.estimatedHours ? "+" : ""}{(j.actualHours - j.estimatedHours).toFixed(1)}h
              </span>
            </div>
          ))}
        </Card>
      )}

      {/* Revenue by space type */}
      {Object.keys(revenueByType).length > 0 && (
        <Card>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💎 Revenue by Space Type</h3>
          {Object.entries(revenueByType).sort((a, b) => b[1] - a[1]).map(([type, amount]) => {
            const pct = totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0;
            const emoji = SPACE_TYPES.find(t => t.label === type)?.emoji || "📦";
            return (
              <div key={type} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{emoji} {type}</span>
                  <span style={{ fontWeight: 700, color: "#7C3AED" }}>{formatCurrency(amount)}</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "#F3E8FF", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 4, background: "linear-gradient(90deg, #FF6B9D, #C084FC)", width: `${Math.min(pct, 100)}%`, transition: "width 0.5s" }} />
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* Rate Analysis */}
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💡 Rate Analysis</h3>
        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 8px" }}>Current rate: <strong style={{ color: "#7C3AED" }}>{formatCurrency(data.settings.hourlyRate)}/hr</strong></p>
          {totalHours > 0 && <p style={{ margin: "0 0 8px" }}>Effective rate: <strong style={{ color: totalRevenue / totalHours >= data.settings.hourlyRate ? "#059669" : "#DC2626" }}>{formatCurrency(totalRevenue / totalHours)}/hr</strong></p>}
          {avgDiff > 1 && <p style={{ margin: 0, background: "#FFF5F7", padding: 8, borderRadius: 8, fontSize: 12 }}>💡 Your estimates are off by {avgDiff.toFixed(1)}h on average. Consider adjusting base times!</p>}
        </div>
      </Card>

      {/* Feedback */}
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💬 Client Feedback</h3>
        {completed.filter(j => j.feedback).length > 0 ? (
          completed.filter(j => j.feedback).map(j => (
            <div key={j.id} style={{ padding: "8px 0", borderBottom: "1px solid #F3F4F6" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{j.clientName}</span>
                <span style={{ fontSize: 12 }}>{"⭐".repeat(j.feedback.rating)}</span>
              </div>
              {j.feedback.text && <p style={{ fontSize: 12, color: "#666", margin: 0, fontStyle: "italic" }}>"{j.feedback.text}"</p>}
            </div>
          ))
        ) : (
          <p style={{ textAlign: "center", color: "#888", fontSize: 13 }}>No feedback yet! Complete jobs to collect reviews ✨</p>
        )}
      </Card>
    </div>
  );
}

// ─── Settings ───
function Settings({ settings, updateSettings, showToast }) {
  const [stripeKey, setStripeKey] = useState(settings.stripeKey || "");
  const [ejsService, setEjsService] = useState(settings.emailjsServiceId || DEFAULT_EMAILJS.serviceId);
  const [ejsTemplate, setEjsTemplate] = useState(settings.emailjsTemplateId || DEFAULT_EMAILJS.templateId);
  const [ejsPublic, setEjsPublic] = useState(settings.emailjsPublicKey || DEFAULT_EMAILJS.publicKey);
  const [showEmailGuide, setShowEmailGuide] = useState(false);
  const [testSending, setTestSending] = useState(false);

  const saveEmailSettings = () => {
    updateSettings({ emailjsServiceId: ejsService, emailjsTemplateId: ejsTemplate, emailjsPublicKey: ejsPublic });
    showToast("Email settings saved! 📧");
  };

  const sendTestEmail = async () => {
    setTestSending(true);
    try {
      await sendEmail({
        to: THEA_EMAIL,
        cc: "",
        subject: "✨ SparkleSpace Test Email",
        htmlBody: buildEmailHTML({
          greeting: "Hi Thea! 👋",
          sections: [{ title: "✅ Email is working!", content: "Your EmailJS setup is configured correctly. You can now send assessments, schedules, and calendar invites directly to clients." }],
          cta: "🎉 You're all set!",
        }),
        settings: { emailjsServiceId: ejsService, emailjsTemplateId: ejsTemplate, emailjsPublicKey: ejsPublic },
      });
      showToast("Test email sent! Check your inbox 📬");
    } catch (err) {
      console.error(err);
      showToast("Test failed — double-check your keys", "error");
    }
    setTestSending(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 800, margin: 0 }}>⚙️ Settings</h2>
      
      {/* Email Setup */}
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📧 Email Service (EmailJS)</h3>
        
        {(settings.emailjsPublicKey || DEFAULT_EMAILJS.publicKey) ? (
          <div style={{ background: "#ECFDF5", borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 12, color: "#059669", fontWeight: 600 }}>
            ✅ Email is configured and ready to send!
          </div>
        ) : (
          <div style={{ background: "#FFF3E0", borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 12, color: "#E65100", fontWeight: 600 }}>
            ⚠️ Set up EmailJS to send emails directly to clients
          </div>
        )}

        <Input label="Service ID" placeholder="service_xxxxxxx" value={ejsService} onChange={(e) => setEjsService(e.target.value)} />
        <Input label="Template ID" placeholder="template_xxxxxxx" value={ejsTemplate} onChange={(e) => setEjsTemplate(e.target.value)} />
        <Input label="Public Key" placeholder="xxxxxxxxxxxxxx" value={ejsPublic} onChange={(e) => setEjsPublic(e.target.value)} />
        
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <GradientButton onClick={saveEmailSettings} style={{ flex: 1 }}>💾 Save</GradientButton>
          {ejsService && ejsTemplate && ejsPublic && (
            <GradientButton variant="success" onClick={sendTestEmail} style={{ flex: 1, opacity: testSending ? 0.6 : 1 }}>
              {testSending ? "⏳ Sending..." : "🧪 Test Email"}
            </GradientButton>
          )}
        </div>

        <button onClick={() => setShowEmailGuide(!showEmailGuide)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#C084FC", padding: 0 }}>
          {showEmailGuide ? "▲ Hide setup guide" : "📖 How to set up EmailJS (free, 5 min)"}
        </button>

        {showEmailGuide && (
          <div style={{ background: "#FDFBFF", border: "1.5px solid #F0E6FF", borderRadius: 12, padding: 14, marginTop: 8, fontSize: 12, color: "#555", lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, color: "#7C3AED", marginBottom: 6, fontSize: 13 }}>🚀 Free EmailJS Setup (200 emails/mo)</div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 1:</strong> Go to <span style={{ color: "#7C3AED", fontWeight: 600 }}>emailjs.com</span> → Sign up free
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 2:</strong> Click "Email Services" → "Add New Service" → Choose Gmail/Outlook/etc → Connect your email account → Copy the <strong>Service ID</strong>
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 3:</strong> Click "Email Templates" → "Create New Template" → Set up like this:
            </div>
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: 10, fontFamily: "monospace", fontSize: 11, marginBottom: 8, whiteSpace: "pre-line" }}>
{`Subject: {{subject}}
To: {{to_email}}
CC: {{cc_email}}
From Name: {{from_name}}
Reply To: {{reply_to}}

Content (HTML): {{message_html}}`}
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 4:</strong> Save template → Copy the <strong>Template ID</strong>
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 5:</strong> Go to "Account" → Copy your <strong>Public Key</strong>
            </div>
            <div style={{ background: "#ECFDF5", borderRadius: 8, padding: 8, fontWeight: 600, color: "#059669" }}>
              ✅ Paste all 3 IDs above, save, and hit "Test Email"!
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💰 Pricing</h3>
        <Input label="Hourly Rate ($)" type="number" min="1" step="0.50" value={settings.hourlyRate} onChange={(e) => updateSettings({ hourlyRate: parseFloat(e.target.value) || DEFAULT_RATE })} />
        <div style={{ fontSize: 11, color: "#888", marginTop: -8, marginBottom: 12 }}>WA sales tax (10.25%) auto-applies for non-cash payments</div>
      </Card>
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💳 Payment Integration</h3>
        <Input label="Stripe Publishable Key" placeholder="pk_live_..." value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} />
        <GradientButton onClick={() => { updateSettings({ stripeKey }); showToast("Stripe key saved! 💳"); }}>Save Stripe Key</GradientButton>
        <div style={{ fontSize: 11, color: "#888", marginTop: 8, lineHeight: 1.5 }}>🔗 Create a free Stripe account at stripe.com to accept card payments. Venmo & Zelle tracked manually.</div>
      </Card>
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>ℹ️ About SparkleSpace</h3>
        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 8px" }}>✨ <strong>SparkleSpace by Thea</strong></p>
          <p style={{ margin: "0 0 8px" }}>Your organizing business management app! Track assessments, schedule jobs, manage clients, handle payments, and grow your business. 🌟</p>
          <p style={{ margin: 0, fontSize: 11, color: "#999" }}>v1.4 • EmailJS Integration • Made with 💜</p>
        </div>
      </Card>
      <Card>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>🗑️ Data</h3>
        <GradientButton variant="danger" onClick={() => { if (confirm("Are you sure? This will delete ALL data!")) { localStorage.removeItem(STORAGE_KEY); window.location.reload(); } }}>Reset All Data</GradientButton>
      </Card>
    </div>
  );
}
