import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants & Helpers ───
const WA_TAX_RATE = 0.1025;
const DEFAULT_RATE = 22;
const STORAGE_KEY = "sparkle_space_data";
const SUPABASE_CONFIG_KEY = "sparkle_supabase_config";
const GDRIVE_CONFIG_KEY = "sparkle_gdrive_config";
const THEA_EMAIL = "babith@hotmail.com";
const THEA_PHONE = "425-428-8687";

// Default Supabase credentials (SparkleSpace project)
const DEFAULT_SUPABASE = {
  url: "https://thsfabqlcpookyxsokay.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoc2ZhYnFsY3Bvb2t5eHNva2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNjI4MDIsImV4cCI6MjA4NzYzODgwMn0.8Pv5PVpjpxpOQ1qArvgF6qas0qFwRmYhS6tAMKvUvWI",
};

// ─── Supabase REST Client (no SDK needed) ───
function getSupabaseConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(SUPABASE_CONFIG_KEY) || "null");
    if (c?.url && c?.anonKey) return c;
  } catch {}
  // Fall back to hardcoded defaults
  return DEFAULT_SUPABASE.url ? DEFAULT_SUPABASE : null;
}

function saveSupabaseConfig(config) {
  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(config));
}

function getGDriveConfig() {
  try {
    return JSON.parse(localStorage.getItem(GDRIVE_CONFIG_KEY) || "null") || { folderId: "", folderUrl: "" };
  } catch { return { folderId: "", folderUrl: "" }; }
}

function saveGDriveConfig(config) {
  localStorage.setItem(GDRIVE_CONFIG_KEY, JSON.stringify(config));
}

async function supaFetch(path, { method = "GET", body, headers = {}, config } = {}) {
  const cfg = config || getSupabaseConfig();
  if (!cfg) throw new Error("SUPABASE_NOT_CONFIGURED");
  const url = `${cfg.url}/rest/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : method === "PATCH" ? "return=representation" : undefined,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${res.status} ${text}`);
  }
  if (method === "DELETE") return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Database Operations ───
const db = {
  // Jobs
  async loadJobs() {
    const rows = await supaFetch("jobs?select=*&order=created_at.desc");
    return rows.map(r => ({ ...JSON.parse(r.data), _dbId: r.id }));
  },
  async upsertJob(job) {
    const dbId = job._dbId;
    // Strip base64 photo data for DB (too large) — keep only metadata
    const jobForDb = JSON.parse(JSON.stringify({ ...job, _dbId: undefined }));
    if (jobForDb.spaces) {
      jobForDb.spaces = jobForDb.spaces.map(s => ({
        ...s,
        beforePhotos: (s.beforePhotos || []).map(p => ({ ...p, url: p.gdriveUrl || "[local]" })),
        afterPhotos: (s.afterPhotos || []).map(p => ({ ...p, url: p.gdriveUrl || "[local]" })),
      }));
    }
    const payload = { id: job.id, data: JSON.stringify(jobForDb), updated_at: new Date().toISOString() };
    if (dbId) {
      const rows = await supaFetch(`jobs?id=eq.${dbId}`, { method: "PATCH", body: payload });
      return rows?.[0] ? { ...JSON.parse(rows[0].data), _dbId: rows[0].id } : job;
    } else {
      payload.created_at = new Date().toISOString();
      const rows = await supaFetch("jobs", { method: "POST", body: payload });
      return rows?.[0] ? { ...JSON.parse(rows[0].data), _dbId: rows[0].id } : job;
    }
  },
  async deleteJob(jobId) {
    await supaFetch(`jobs?id=eq.${jobId}`, { method: "DELETE" });
  },

  // Settings
  async loadSettings() {
    const rows = await supaFetch("app_settings?select=*&key=eq.main&limit=1");
    if (rows?.[0]) return JSON.parse(rows[0].data);
    return null;
  },
  async saveSettings(settings) {
    const payload = { key: "main", data: JSON.stringify(settings), updated_at: new Date().toISOString() };
    // Try update first, then insert
    const existing = await supaFetch("app_settings?key=eq.main&select=key");
    if (existing?.length > 0) {
      await supaFetch("app_settings?key=eq.main", { method: "PATCH", body: payload });
    } else {
      await supaFetch("app_settings", { method: "POST", body: { ...payload, created_at: new Date().toISOString() } });
    }
  },

  // Photos — store reference (gdrive link + filename)
  async savePhotoRef({ jobId, spaceId, type, filename, gdriveUrl }) {
    return supaFetch("photo_refs", {
      method: "POST",
      body: { job_id: jobId, space_id: spaceId, photo_type: type, filename, gdrive_url: gdriveUrl, created_at: new Date().toISOString() },
    });
  },
  async loadPhotoRefs(jobId) {
    return supaFetch(`photo_refs?job_id=eq.${jobId}&select=*`);
  },
  async deletePhotoRef(id) {
    await supaFetch(`photo_refs?id=eq.${id}`, { method: "DELETE" });
  },

  // Test connection
  async testConnection(config) {
    try {
      await supaFetch("jobs?select=id&limit=1", { config });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};

// EmailJS free tier: 200 emails/month — perfect for a small biz
// Default EmailJS credentials (Thea's account)
const DEFAULT_EMAILJS = {
  serviceId: "service_TheaApp",
  templateId: "template_x9q340z",
  publicKey: "Zp60lxBPh3IE_O58V",
};

// Send email via EmailJS REST API (no CDN/SDK needed)
async function sendEmail({ to, cc, subject, htmlBody, settings }) {
  const serviceId = settings?.emailjsServiceId || DEFAULT_EMAILJS.serviceId;
  const templateId = settings?.emailjsTemplateId || DEFAULT_EMAILJS.templateId;
  const publicKey = settings?.emailjsPublicKey || DEFAULT_EMAILJS.publicKey;

  if (!serviceId || !templateId || !publicKey) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }

  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: {
        to_email: to,
        cc_email: cc || "",
        subject: subject,
        message_html: htmlBody,
        from_name: "SparkleSpace by Thea",
        reply_to: THEA_EMAIL,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Email send failed");
  }
  return response;
}

// Build pretty HTML email body
function buildEmailHTML({ greeting, sections, cta, footer }) {
  const sectionHTML = sections.map(s => 
    `<div style="margin-bottom:16px;">` +
    (s.title ? `<div style="font-weight:700;color:#D6006E;font-size:14px;margin-bottom:6px;">${s.title}</div>` : "") +
    `<div style="color:#444;font-size:13px;line-height:1.6;white-space:pre-line;">${s.content}</div>` +
    `</div>`
  ).join("");

  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <div style="background:linear-gradient(135deg,#FF1493,#FF69B4,#FF85C8);padding:20px 24px;border-radius:16px 16px 0 0;color:#fff;">
        <h1 style="margin:0;font-size:20px;">✨ SparkleSpace</h1>
        <p style="margin:4px 0 0;font-size:12px;opacity:0.9;">by Thea • Organization Magic</p>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 16px 16px;">
        <p style="font-size:15px;color:#333;margin:0 0 16px;">${greeting}</p>
        ${sectionHTML}
        ${cta ? `<div style="background:linear-gradient(135deg,#FFF0F5,#FFE4F0);border-radius:12px;padding:14px;text-align:center;margin:16px 0;font-size:14px;font-weight:700;color:#D6006E;">${cta}</div>` : ""}
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
  const [dbConnected, setDbConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncTimeout = useRef(null);

  // Save to localStorage always (instant cache)
  useEffect(() => { saveData(data); }, [data]);

  // Initial load: try Supabase, fall back to localStorage
  useEffect(() => {
    const cfg = getSupabaseConfig();
    if (!cfg) return;
    setSyncing(true);
    Promise.all([db.loadJobs(), db.loadSettings()])
      .then(([jobs, settings]) => {
        setDbConnected(true);
        setData(prev => ({
          ...prev,
          jobs: jobs.length > 0 ? jobs : prev.jobs,
          settings: settings ? { ...prev.settings, ...settings } : prev.settings,
        }));
      })
      .catch(err => { console.warn("Supabase load failed, using local:", err); setDbConnected(false); })
      .finally(() => setSyncing(false));
  }, []);

  // Debounced sync to Supabase on data changes
  const syncToSupabase = useCallback((newData) => {
    if (!getSupabaseConfig()) return;
    if (syncTimeout.current) clearTimeout(syncTimeout.current);
    syncTimeout.current = setTimeout(async () => {
      try {
        // Sync all jobs
        const syncedJobs = await Promise.all(
          newData.jobs.map(job => db.upsertJob(job).catch(err => { console.warn("Job sync failed:", err); return job; }))
        );
        // Sync settings
        await db.saveSettings(newData.settings).catch(err => console.warn("Settings sync failed:", err));
        // Update local data with any _dbId values from Supabase
        setData(prev => ({ ...prev, jobs: syncedJobs }));
        setDbConnected(true);
      } catch (err) {
        console.warn("Supabase sync failed:", err);
      }
    }, 1500); // 1.5s debounce
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const updateJob = (id, updates) => {
    setData((prev) => {
      const newData = { ...prev, jobs: prev.jobs.map((j) => (j.id === id ? { ...j, ...updates } : j)) };
      syncToSupabase(newData);
      return newData;
    });
  };

  const addJob = (job) => {
    setData((prev) => {
      const newData = { ...prev, jobs: [job, ...prev.jobs] };
      syncToSupabase(newData);
      return newData;
    });
    showToast("Job created! ✨");
  };

  const deleteJob = (id) => {
    const job = data.jobs.find(j => j.id === id);
    if (job?._dbId && getSupabaseConfig()) {
      db.deleteJob(job._dbId).catch(err => console.warn("Delete from DB failed:", err));
    }
    setData((prev) => ({ ...prev, jobs: prev.jobs.filter(j => j.id !== id) }));
    showToast("Job deleted");
  };

  const updateSettings = (settings) => {
    setData((prev) => {
      const newData = { ...prev, settings: { ...prev.settings, ...settings } };
      syncToSupabase(newData);
      return newData;
    });
  };

  // Force re-sync from Supabase
  const forceSync = async () => {
    const cfg = getSupabaseConfig();
    if (!cfg) return showToast("Set up database in Settings first!", "error");
    setSyncing(true);
    try {
      const [jobs, settings] = await Promise.all([db.loadJobs(), db.loadSettings()]);
      setData(prev => ({
        ...prev,
        jobs: jobs.length > 0 ? jobs : prev.jobs,
        settings: settings ? { ...prev.settings, ...settings } : prev.settings,
      }));
      setDbConnected(true);
      showToast("Synced from database! ☁️");
    } catch (err) {
      showToast("Sync failed: " + err.message, "error");
    }
    setSyncing(false);
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
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #FFF0F5 0%, #FFF0E5 30%, #F0F7FF 70%, #F5F0FF 100%)", fontFamily: "'Poppins', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap" rel="stylesheet" />
      
      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: toast.type === "success" ? "#10B981" : "#EF4444", color: "#fff", padding: "12px 24px", borderRadius: 16, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.15)", animation: "slideDown 0.3s ease" }}>
          {toast.msg}
        </div>
      )}

      <header style={{ background: "linear-gradient(135deg, #FF1493 0%, #FF69B4 40%, #FF85C8 100%)", padding: "16px 20px", color: "#fff", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 20px rgba(255,20,147,0.3)" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "'Sora', sans-serif", fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>✨ SparkleSpace</h1>
            <p style={{ fontSize: 11, opacity: 0.9, margin: 0, fontWeight: 500 }}>
              by Thea • Organization Magic
              {dbConnected && <span style={{ marginLeft: 6, fontSize: 9, background: "rgba(255,255,255,0.3)", padding: "1px 6px", borderRadius: 8 }}>{syncing ? "⏳ syncing..." : "☁️ cloud"}</span>}
            </p>
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
        {currentView === "settings" && <Settings settings={data.settings} updateSettings={updateSettings} showToast={showToast} dbConnected={dbConnected} setDbConnected={setDbConnected} forceSync={forceSync} syncing={syncing} />}
      </main>

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(0,0,0,0.06)", padding: "8px 0 max(8px, env(safe-area-inset-bottom))", zIndex: 100 }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", justifyContent: "space-around" }}>
          {navItems.map((item) => (
            <button key={item.id} onClick={() => setCurrentView(item.id)} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", padding: "4px 12px", borderRadius: 12, transition: "all 0.2s", ...(currentView === item.id ? { background: "linear-gradient(135deg, #FFD6E8, #FFE4F0)", transform: "scale(1.05)" } : {}) }}>
              <span style={{ fontSize: 20 }}>{item.emoji}</span>
              <span style={{ fontSize: 10, fontWeight: currentView === item.id ? 700 : 500, color: currentView === item.id ? "#FF69B4" : "#999" }}>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <style>{`
        @keyframes slideDown { from { opacity: 0; transform: translate(-50%, -20px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        input, textarea, select { font-family: 'Poppins', sans-serif; }
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
      <input {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "2px solid #FFD6E8", fontSize: 14, outline: "none", transition: "border-color 0.2s", background: "#FFF5F8", ...props.style }} onFocus={(e) => e.target.style.borderColor = "#FF69B4"} onBlur={(e) => e.target.style.borderColor = "#FFD6E8"} />
    </div>
  );
}

function TextArea({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>{label}</label>}
      <textarea {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "2px solid #FFD6E8", fontSize: 14, outline: "none", minHeight: 80, resize: "vertical", background: "#FFF5F8", ...props.style }} onFocus={(e) => e.target.style.borderColor = "#FF69B4"} onBlur={(e) => e.target.style.borderColor = "#FFD6E8"} />
    </div>
  );
}

function Select({ label, options, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 4, display: "block" }}>{label}</label>}
      <select {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "2px solid #FFD6E8", fontSize: 14, outline: "none", background: "#FFF5F8", cursor: "pointer", ...props.style }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function GradientButton({ children, onClick, style = {}, variant = "primary" }) {
  const styles = {
    primary: { background: "linear-gradient(135deg, #FF1493, #FF69B4)", color: "#fff" },
    secondary: { background: "linear-gradient(135deg, #FFE4F0, #FFD6E8)", color: "#B5005A" },
    success: { background: "linear-gradient(135deg, #34D399, #60A5FA)", color: "#fff" },
    danger: { background: "linear-gradient(135deg, #FB7185, #F43F5E)", color: "#fff" },
  };
  return (
    <button onClick={onClick} style={{ border: "none", borderRadius: 14, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer", width: "100%", fontFamily: "'Poppins', sans-serif", ...styles[variant], ...style }}>
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

function PhotoUpload({ photos = [], onPhotosChange, label, jobName, spaceType, photoType }) {
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [facingMode, setFacingMode] = useState("environment");
  const [cameraError, setCameraError] = useState("");
  const [flashEffect, setFlashEffect] = useState(false);
  const [capturedPreview, setCapturedPreview] = useState(null);

  const makeFilename = (ext = ".jpg") => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeName = (jobName || "job").replace(/[^a-zA-Z0-9]/g, "-").slice(0, 20);
    const safeSpace = (spaceType || "space").replace(/[^a-zA-Z0-9]/g, "-").slice(0, 15);
    return `SparkleSpace_${safeName}_${safeSpace}_${photoType || "photo"}_${timestamp}${ext}`;
  };

  const addPhoto = (dataUrl, originalName = "camera-photo.jpg") => {
    onPhotosChange([...photos, {
      id: generateId(),
      url: dataUrl,
      timestamp: new Date().toISOString(),
      originalName,
      descriptiveFilename: makeFilename(originalName.match(/\.[^.]+$/)?.[0] || ".jpg"),
      gdriveUrl: "",
    }]);
  };

  const handleFiles = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => addPhoto(ev.target.result, file.name);
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const openCamera = async () => {
    setCameraError("");
    setCapturedPreview(null);
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      setCameraStream(stream);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (err) {
      if (err.name === "NotAllowedError" || err.name === "NotFoundError") {
        setCameraError("camera");
        // Fallback: use native file input with capture
        setCameraOpen(false);
        if (cameraRef.current) cameraRef.current.click();
      } else {
        setCameraError("Could not access camera: " + err.message);
      }
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
    }
    setCameraOpen(false);
    setCapturedPreview(null);
  };

  const flipCamera = async () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setCameraError("Could not switch camera");
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    // Flash animation
    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 200);
    setCapturedPreview(dataUrl);
  };

  const acceptPhoto = () => {
    if (capturedPreview) {
      addPhoto(capturedPreview, "camera-snap.jpg");
      setCapturedPreview(null);
    }
  };

  const retakePhoto = () => {
    setCapturedPreview(null);
  };

  const removePhoto = (id) => onPhotosChange(photos.filter(p => p.id !== id));

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    };
  }, [cameraStream]);

  const gdriveConfig = getGDriveConfig();
  const hasGDrive = gdriveConfig?.folderUrl;

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 8, display: "block" }}>{label}</label>
      
      {/* Photo grid */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {photos.map(p => (
          <div key={p.id} style={{ position: "relative", width: 72, height: 72, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(255,20,147,0.15)" }}>
            <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {p.gdriveUrl && <div style={{ position: "absolute", bottom: 2, left: 2, background: "rgba(34,197,94,0.9)", borderRadius: 4, padding: "0 4px", fontSize: 8, color: "#fff", fontWeight: 700 }}>☁️</div>}
            <button onClick={(e) => { e.stopPropagation(); removePhoto(p.id); }} style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        ))}
      </div>

      {/* Two action buttons: Camera + Gallery */}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={openCamera} style={{ flex: 1, padding: "12px 8px", borderRadius: 14, border: "2px dashed #FF69B4", background: "linear-gradient(135deg, #FFF0F5, #FFE4F0)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, color: "#FF1493", fontWeight: 700, gap: 4, fontFamily: "Sora, sans-serif", transition: "all 0.2s" }}>
          <span style={{ fontSize: 26 }}>📷</span>
          Take Photo
        </button>
        <button onClick={() => galleryRef.current?.click()} style={{ flex: 1, padding: "12px 8px", borderRadius: 14, border: "2px dashed #FFB3D9", background: "linear-gradient(135deg, #FFF5FA, #FFF0F5)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, color: "#D6006E", fontWeight: 700, gap: 4, fontFamily: "Sora, sans-serif", transition: "all 0.2s" }}>
          <span style={{ fontSize: 26 }}>🖼️</span>
          From Gallery
        </button>
      </div>

      {/* Hidden file inputs */}
      <input ref={galleryRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: "none" }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFiles} style={{ display: "none" }} />

      {/* GDrive info */}
      {hasGDrive && photos.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#E91E8B" }}>
          📁 Upload photos to <a href={gdriveConfig.folderUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#D6006E", fontWeight: 600 }}>Google Drive folder</a> with these names for easy lookup
          {photos.filter(p => p.descriptiveFilename).map(p => (
            <div key={p.id} style={{ fontFamily: "monospace", fontSize: 9, color: "#666", marginTop: 2, wordBreak: "break-all" }}>📎 {p.descriptiveFilename}</div>
          ))}
        </div>
      )}

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* ===== FULLSCREEN CAMERA MODAL ===== */}
      {cameraOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000, background: "#000", display: "flex", flexDirection: "column" }}>
          {/* Top bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "rgba(0,0,0,0.7)", zIndex: 2 }}>
            <button onClick={stopCamera} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, padding: "8px 16px", borderRadius: 20, cursor: "pointer", fontFamily: "Sora, sans-serif", backdropFilter: "blur(8px)" }}>✕ Close</button>
            <div style={{ color: "#FF69B4", fontSize: 13, fontWeight: 700, fontFamily: "Sora, sans-serif", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
              📸 {photoType === "before" ? "Before Photo" : photoType === "after" ? "After Photo" : photoType === "assessment" ? "Assessment" : "Snap a Pic"}
            </div>
            <button onClick={flipCamera} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 18, padding: "8px 14px", borderRadius: 20, cursor: "pointer", backdropFilter: "blur(8px)" }}>🔄</button>
          </div>

          {/* Camera feed / Preview */}
          <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {cameraError && cameraError !== "camera" ? (
              <div style={{ color: "#FF69B4", textAlign: "center", padding: 32, fontFamily: "Sora, sans-serif" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>😿</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{cameraError}</div>
                <button onClick={stopCamera} style={{ background: "#FF1493", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 20, fontWeight: 700, cursor: "pointer", fontFamily: "Sora, sans-serif" }}>Go Back</button>
              </div>
            ) : capturedPreview ? (
              <img src={capturedPreview} alt="Preview" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : (
              <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: facingMode === "user" ? "scaleX(-1)" : "none" }} />
            )}

            {/* Flash effect */}
            {flashEffect && (
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "#fff", opacity: 0.8, transition: "opacity 0.2s", pointerEvents: "none" }} />
            )}

            {/* Photo count badge */}
            {photos.length > 0 && (
              <div style={{ position: "absolute", top: 12, right: 12, background: "linear-gradient(135deg, #FF1493, #FF69B4)", color: "#fff", borderRadius: 16, padding: "4px 12px", fontSize: 12, fontWeight: 700, fontFamily: "Sora, sans-serif", boxShadow: "0 2px 8px rgba(255,20,147,0.4)" }}>
                {photos.length} pic{photos.length !== 1 ? "s" : ""} ✨
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div style={{ padding: "16px 24px 32px", background: "rgba(0,0,0,0.7)", display: "flex", justifyContent: "center", alignItems: "center", gap: 24 }}>
            {capturedPreview ? (
              <>
                <button onClick={retakePhoto} style={{ background: "rgba(255,255,255,0.15)", border: "2px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: 14, fontWeight: 700, padding: "14px 28px", borderRadius: 28, cursor: "pointer", fontFamily: "Sora, sans-serif", backdropFilter: "blur(8px)" }}>
                  🔄 Retake
                </button>
                <button onClick={acceptPhoto} style={{ background: "linear-gradient(135deg, #FF1493, #FF69B4)", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, padding: "14px 28px", borderRadius: 28, cursor: "pointer", fontFamily: "Sora, sans-serif", boxShadow: "0 4px 16px rgba(255,20,147,0.5)" }}>
                  ✅ Use This!
                </button>
              </>
            ) : (
              <>
                {/* Shutter button */}
                <button onClick={capturePhoto} style={{ width: 72, height: 72, borderRadius: "50%", border: "4px solid #FF69B4", background: "radial-gradient(circle, #fff 60%, #FFE4F0 100%)", cursor: "pointer", boxShadow: "0 0 20px rgba(255,105,180,0.5), inset 0 0 8px rgba(255,20,147,0.2)", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.1s" }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #FF1493, #FF69B4)", boxShadow: "inset 0 2px 4px rgba(255,255,255,0.3)" }} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Space Editor Card (used in both NewJob and JobDetail) ───
function SpaceEditorCard({ space, index, total, onUpdate, onRemove, collapsed, onToggle, jobName }) {
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
    <div style={{ background: "#fff", border: "2px solid #FFD6E8", borderRadius: 16, marginBottom: 10, overflow: "hidden", animation: "fadeIn 0.3s ease" }}>
      {/* Collapsed header — always visible */}
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer", background: collapsed ? "#FFF5F8" : "linear-gradient(135deg, #FFF0F5, #FFE4F0)" }}>
        <span style={{ fontSize: 22 }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            {space.spaceType}
            <span style={{ fontWeight: 500, color: "#FF1493", marginLeft: 6, fontSize: 11 }}>
              {space.estimatedHours || hours}h
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#999" }}>
            {space.size} • {space.clutterLevel} clutter
          </div>
        </div>
        <span style={{ fontSize: 11, color: "#FF69B4", fontWeight: 700 }}>{collapsed ? "▼" : "▲"}</span>
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
              <button key={t.label} onClick={() => updateFields({ spaceType: t.label, _manualOverride: false })} style={{ padding: "8px 6px", borderRadius: 10, border: space.spaceType === t.label ? "2px solid #FF69B4" : "1.5px solid #E5E7EB", background: space.spaceType === t.label ? "#FFE4F0" : "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                <span style={{ fontSize: 16, display: "block" }}>{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6, display: "block" }}>Size</label>
          <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
            {Object.keys(SIZE_MULTIPLIERS).map((s) => (
              <button key={s} onClick={() => updateFields({ size: s, _manualOverride: false })} style={{ flex: 1, padding: "7px 3px", borderRadius: 8, border: space.size === s ? "2px solid #FF69B4" : "1.5px solid #E5E7EB", background: space.size === s ? "#FFE4F0" : "#fff", cursor: "pointer", fontSize: 10, fontWeight: 600, textTransform: "capitalize" }}>
                {s === "xlarge" ? "XL" : s}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6, display: "block" }}>Clutter Level</label>
          <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
            {Object.keys(CLUTTER_MULTIPLIERS).map((c) => (
              <button key={c} onClick={() => updateFields({ clutterLevel: c, _manualOverride: false })} style={{ flex: 1, padding: "7px 3px", borderRadius: 8, border: space.clutterLevel === c ? "2px solid #FF69B4" : "1.5px solid #E5E7EB", background: space.clutterLevel === c ? "#FFE4F0" : "#fff", cursor: "pointer", fontSize: 10, fontWeight: 600, textTransform: "capitalize" }}>
                {c}
              </button>
            ))}
          </div>

          <TextArea label="Notes for this space" placeholder="What needs to be done here?" value={space.notes || ""} onChange={(e) => updateField("notes", e.target.value)} />
          
          <PhotoUpload label="📸 Before Photos" photos={space.beforePhotos || []} onPhotosChange={(p) => updateField("beforePhotos", p)} jobName={jobName} spaceType={space.spaceType} photoType="before" />

          {/* Per-space estimate with override */}
          <div style={{ background: "linear-gradient(135deg, #FFF0F5, #FFE4F0)", borderRadius: 12, padding: 10, marginTop: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "#888" }}>🤖 Auto: {hours}h</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#888" }}>Override:</span>
                <input type="number" step="0.5" min="0" value={space.estimatedHours || hours} onChange={(e) => updateField("estimatedHours", parseFloat(e.target.value) || 0)} style={{ width: 60, padding: "4px 8px", borderRadius: 8, border: "1.5px solid #FFB3D9", fontSize: 12, textAlign: "center", outline: "none", background: "#fff" }} />
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
        <span style={{ fontSize: 11, color: "#FF1493", fontWeight: 700 }}>{scheduledH}h of {totalHours}h</span>
      </div>
      
      <div style={{ marginBottom: 10 }}>
        <div style={{ height: 8, borderRadius: 4, background: "#FFE4F0", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 4, background: pct >= 100 ? "linear-gradient(90deg, #34D399, #60A5FA)" : "linear-gradient(90deg, #FF1493, #FF69B4)", width: `${pct}%`, transition: "width 0.4s" }} />
        </div>
        <div style={{ fontSize: 11, color: remaining > 0 ? "#E11D48" : "#059669", fontWeight: 600, marginTop: 3 }}>
          {remaining > 0 ? `${remaining}h still needs scheduling` : "✅ All hours scheduled!"}
        </div>
      </div>

      {scheduleDays.map((day, index) => (
        <div key={day.id} style={{ background: "#FFF5F8", border: "1.5px solid #FFD6E8", borderRadius: 14, padding: 12, marginBottom: 8, animation: "fadeIn 0.2s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#D6006E" }}>Day {index + 1} {day.date ? `• ${formatDate(day.date)}` : ""}</span>
            <button onClick={() => removeDay(index)} style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 8, padding: "3px 8px", fontSize: 11, color: "#E11D48", fontWeight: 700, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#999", display: "block", marginBottom: 3 }}>Date</label>
              <input type="date" value={day.date} onChange={(e) => updateDay(index, { date: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #FFD6E8", fontSize: 13, outline: "none", background: "#fff" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#999", display: "block", marginBottom: 3 }}>Start Time</label>
              <input type="time" value={day.startTime} onChange={(e) => updateDay(index, { startTime: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #FFD6E8", fontSize: 13, outline: "none", background: "#fff" }} />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: "#999", display: "block", marginBottom: 3 }}>Hours Thea will work this day</label>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[1, 1.5, 2, 3, 4, 5, 6, 8].map(h => (
                <button key={h} onClick={() => updateDay(index, { hours: h })} style={{ padding: "5px 10px", borderRadius: 8, border: day.hours === h ? "2px solid #FF69B4" : "1.5px solid #E5E7EB", background: day.hours === h ? "#FFE4F0" : "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, color: day.hours === h ? "#D6006E" : "#666" }}>
                  {h}h
                </button>
              ))}
            </div>
            <input type="number" step="0.5" min="0.5" max="12" placeholder="Custom hours" value={day.hours || ""} onChange={(e) => updateDay(index, { hours: parseFloat(e.target.value) || 0 })} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #FFD6E8", fontSize: 12, outline: "none", background: "#fff", marginTop: 6 }} />
          </div>
        </div>
      ))}

      <button onClick={addDay} style={{ width: "100%", padding: "11px", borderRadius: 12, border: "2px dashed #FF69B4", background: "linear-gradient(135deg, #FFF0F5, #FFE4F0)", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#D6006E", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
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
      <Card style={{ background: "linear-gradient(135deg, #FF1493 0%, #FF69B4 40%, #FF85C8 100%)", color: "#fff", border: "none" }}>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>Hey Thea! 👋</h2>
        <p style={{ fontSize: 13, opacity: 0.9, margin: 0 }}>Ready to make some spaces sparkle today? ✨</p>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => { setShowNewJob(true); setCurrentView("jobs"); }} style={{ flex: 1, background: "rgba(255,255,255,0.25)", border: "2px solid rgba(255,255,255,0.4)", borderRadius: 12, padding: "10px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", backdropFilter: "blur(10px)" }}>✨ New Assessment</button>
          <button onClick={() => setCurrentView("calendar")} style={{ flex: 1, background: "rgba(255,255,255,0.15)", border: "2px solid rgba(255,255,255,0.3)", borderRadius: 12, padding: "10px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>📅 My Calendar</button>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Active Jobs", value: stats.active, emoji: "🔥", color: "#FF1493" },
          { label: "Completed", value: stats.completed, emoji: "✅", color: "#34D399" },
          { label: "Earned", value: formatCurrency(stats.revenue), emoji: "💰", color: "#FF69B4" },
          { label: "Pending", value: formatCurrency(stats.pending), emoji: "⏳", color: "#60A5FA" },
        ].map((s) => (
          <Card key={s.label} style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>{s.emoji}</div>
            <div style={{ fontFamily: "'Sora', sans-serif", fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#999", fontWeight: 600 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {needsAction.length > 0 && (
        <div>
          <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 16, fontWeight: 700, color: "#333", margin: "0 0 10px" }}>⚡ Needs Action</h3>
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
          <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 16, fontWeight: 700, color: "#333", margin: "0 0 10px" }}>📅 Coming Up</h3>
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
          <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 18, fontWeight: 800, color: "#333", margin: "0 0 8px" }}>Your journey starts here!</h3>
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
              <button key={f} onClick={() => setFilter(f)} style={{ whiteSpace: "nowrap", padding: "6px 14px", borderRadius: 20, border: filter === f ? "2px solid #FF69B4" : "2px solid #E5E7EB", background: filter === f ? "#FFE4F0" : "#fff", color: filter === f ? "#D6006E" : "#666", fontWeight: 600, fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}>
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
        <div style={{ width: 44, height: 44, borderRadius: 14, background: "linear-gradient(135deg, #FFF0E5, #FFE4F0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: spaces.length > 2 ? 14 : 20, flexShrink: 0 }}>
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
                <span key={s.id} style={{ fontSize: 9, background: "#FFE4F0", color: "#D6006E", padding: "2px 6px", borderRadius: 6, fontWeight: 600 }}>
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
            <div style={{ fontSize: 11, color: "#FF1493", fontWeight: 600, marginTop: 3 }}>📅 {formatDate(job.scheduledDate)}</div>
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
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: i < step ? "linear-gradient(90deg, #FF1493, #FF69B4)" : "#E5E7EB", transition: "all 0.3s" }} />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: 20, fontWeight: 800, margin: 0 }}>
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
          <div style={{ background: "linear-gradient(135deg, #FFF0F5, #FFE4F0, #EFF6FF)", borderRadius: 14, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#333" }}>{spaces.length} space{spaces.length > 1 ? "s" : ""}</span>
              <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>
                {getJobEmojis(spaces)}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#D6006E" }}>
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

          <button onClick={addSpace} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "2px dashed #FF69B4", background: "linear-gradient(135deg, #FFF0F5, #FFE4F0)", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#D6006E", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}>
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
          <div style={{ background: "linear-gradient(135deg, #FFF0F5, #FFE4F0, #EFF6FF)", borderRadius: 16, padding: 16, marginTop: 8 }}>
            <h4 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💎 Estimate Breakdown</h4>
            
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
              <span style={{ fontWeight: 800, fontFamily: "'Sora', sans-serif", fontSize: 16 }}>Total</span>
              <span style={{ fontWeight: 800, fontFamily: "'Sora', sans-serif", fontSize: 20, color: "#D6006E" }}>{formatCurrency(calculateTotal())}</span>
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
      costLines += `<br><strong style="font-size:16px;color:#D6006E;">Estimated Total: ${formatCurrency(job.totalEstimate || job.estimatedCost)}</strong>`;

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
          { title: "💰 Estimated Total", content: `<strong style="font-size:16px;color:#D6006E;">${formatCurrency(job.totalEstimate || job.estimatedCost)}</strong> (${job.estimatedHours}h total)` },
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
          { title: "💰 Estimated Total", content: `<strong style="font-size:16px;color:#D6006E;">${formatCurrency(job.totalEstimate || job.estimatedCost)}</strong>` },
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
      <button onClick={() => setCurrentView("jobs")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#FF69B4", textAlign: "left", padding: 0 }}>← Back to Jobs</button>

      {/* Header */}
      <Card style={{ background: "linear-gradient(135deg, #FFF0F5, #FFE4F0)", border: "1px solid #E8D5FF" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>{job.clientName}</h2>
            <p style={{ fontSize: 13, color: "#888", margin: 0 }}>{getJobEmojis(spaces)} {getJobSummary(spaces)} • {job.clientAddress || "No address"}</p>
            {job.clientPhone && <p style={{ fontSize: 12, color: "#FF1493", margin: "4px 0 0", fontWeight: 600 }}>📱 {job.clientPhone}</p>}
          </div>
          <StatusBadge status={job.status} />
        </div>
        {/* Space chips */}
        {spaces.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {spaces.map(s => (
              <span key={s.id} style={{ fontSize: 11, background: "rgba(192,132,252,0.15)", color: "#D6006E", padding: "3px 10px", borderRadius: 10, fontWeight: 600 }}>
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
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>⏱️ Time & Cost</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: "#FFF0F5", borderRadius: 12, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>Estimated</div>
            <div style={{ fontWeight: 800, color: "#FF1493", fontSize: 16 }}>{job.estimatedHours}h</div>
            <div style={{ fontSize: 11, color: "#888" }}>{formatCurrency(job.estimatedCost)}</div>
          </div>
          <div style={{ background: "#FFE4F0", borderRadius: 12, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>Actual</div>
            <div style={{ fontWeight: 800, color: "#D6006E", fontSize: 16 }}>{job.actualHours ? `${job.actualHours}h` : "—"}</div>
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
          <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: 0 }}>🏠 Spaces ({spaces.length})</h3>
          <button onClick={addSpaceToJob} style={{ background: "linear-gradient(135deg, #FFE4F0, #FFF0F5)", border: "1.5px solid #FFB3D9", borderRadius: 10, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: "#D6006E", cursor: "pointer" }}>
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
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📸 After Photos</h3>
        {spaces.map((space, index) => (
          <div key={space.id} style={{ marginBottom: 10 }}>
            <PhotoUpload
              label={`${SPACE_TYPES.find(t => t.label === space.spaceType)?.emoji || "📦"} ${space.spaceType} — After`}
              photos={space.afterPhotos || []}
              onPhotosChange={(p) => {
                const updated = { ...space, afterPhotos: p };
                updateSpace(index, updated);
              }}
              jobName={job.clientName}
              spaceType={space.spaceType}
              photoType="after"
            />
          </div>
        ))}
      </Card>

      {/* Notes */}
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📝 Job Notes</h3>
        <TextArea value={job.notes || ""} onChange={(e) => updateJob(job.id, { notes: e.target.value })} placeholder="Add job notes..." />
      </Card>

      {/* Actions */}
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>⚡ Actions</h3>
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
                {job.clientEmail && <div style={{ fontSize: 11, color: "#FF1493", marginTop: 2 }}>📧 {job.clientEmail}</div>}
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
              <div style={{ background: "#FFF0F5", borderRadius: 12, padding: 12, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>Started at</div>
                <div style={{ fontWeight: 800, color: "#FF1493", fontSize: 16 }}>{formatTime(job.actualStartTime)}</div>
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
              <div style={{ background: "#FFE4F0", borderRadius: 12, padding: 12, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>Invoice Amount</div>
                <div style={{ fontWeight: 800, color: "#D6006E", fontSize: 22 }}>{formatCurrency(job.invoiceAmount)}</div>
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
          <div style={{ marginTop: 8, background: "#FFF5F8", borderRadius: 12, padding: 12, border: "1px solid #FFD6E8" }}>
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
                    <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, background: isCurrent ? "linear-gradient(135deg, #FF1493, #FF69B4)" : isDone ? "#34D399" : "#E5E7EB", color: isCurrent || isDone ? "#fff" : "#999", fontWeight: 700 }}>
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
            <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 18, fontWeight: 800, margin: "0 0 14px" }}>🌟 Client Feedback</h3>
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
    <div style={{ fontFamily: "'Sora', sans-serif", fontSize: 28, fontWeight: 800, color: "#FF1493", marginTop: 4, letterSpacing: 2 }}>
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
        <button onClick={() => setCurrentMonth(new Date(year, month - 1))} style={{ background: "#FFE4F0", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontWeight: 700, color: "#D6006E" }}>‹</button>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: 18, fontWeight: 800, margin: 0 }}>📅 {monthName}</h2>
        <button onClick={() => setCurrentMonth(new Date(year, month + 1))} style={{ background: "#FFE4F0", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontWeight: 700, color: "#D6006E" }}>›</button>
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
              <div key={day} style={{ padding: "6px 2px", borderRadius: 10, minHeight: 44, background: today ? "linear-gradient(135deg, #FF1493, #FF69B4)" : jobs.length ? "#FFE4F0" : "transparent", cursor: jobs.length ? "pointer" : "default" }} onClick={() => { if (jobs.length) openJob(jobs[0].id); }}>
                <div style={{ fontSize: 12, fontWeight: today ? 800 : 500, color: today ? "#fff" : "#333" }}>{day}</div>
                {jobs.slice(0, 2).map((j, idx) => (
                  <div key={idx} style={{ fontSize: 7, background: today ? "rgba(255,255,255,0.3)" : "#FF69B4", color: "#fff", borderRadius: 4, padding: "1px 3px", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                    {j.clientName.split(" ")[0]}
                  </div>
                ))}
                {jobs.length > 2 && <div style={{ fontSize: 7, color: today ? "#fff" : "#FF1493", fontWeight: 700 }}>+{jobs.length - 2}</div>}
              </div>
            );
          })}
        </div>
      </Card>
      <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, color: "#333", margin: "16px 0 10px" }}>📋 This Month's Jobs</h3>
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
                  {entry.totalDays > 1 && <span style={{ fontSize: 10, color: "#FF1493", fontWeight: 600, marginLeft: 6 }}>Day {entry.dayIndex + 1}/{entry.totalDays}</span>}
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
      <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: 22, fontWeight: 800, margin: 0 }}>📊 Your Stats</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Total Revenue", value: formatCurrency(totalRevenue), emoji: "💰", color: "#34D399" },
          { label: "Total Hours", value: `${Math.round(totalHours * 10) / 10}h`, emoji: "⏱️", color: "#60A5FA" },
          { label: "Jobs Done", value: completed.length, emoji: "✅", color: "#FF69B4" },
          { label: "Spaces Done", value: totalSpaces, emoji: "🏠", color: "#FF1493" },
          { label: "Avg Rating", value: avgRating ? `${avgRating.toFixed(1)} ⭐` : "—", emoji: "🌟", color: "#F59E0B" },
          { label: "Avg Accuracy", value: avgDiff ? `±${avgDiff.toFixed(1)}h` : "—", emoji: "🎯", color: "#E91E8B" },
        ].map((s) => (
          <Card key={s.label} style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>{s.emoji}</div>
            <div style={{ fontFamily: "'Sora', sans-serif", fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#999", fontWeight: 600 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Accuracy */}
      {estimateAccuracy.length > 0 && (
        <Card>
          <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>🎯 Estimate Accuracy</h3>
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
          <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💎 Revenue by Space Type</h3>
          {Object.entries(revenueByType).sort((a, b) => b[1] - a[1]).map(([type, amount]) => {
            const pct = totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0;
            const emoji = SPACE_TYPES.find(t => t.label === type)?.emoji || "📦";
            return (
              <div key={type} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{emoji} {type}</span>
                  <span style={{ fontWeight: 700, color: "#D6006E" }}>{formatCurrency(amount)}</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "#FFE4F0", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 4, background: "linear-gradient(90deg, #FF1493, #FF69B4)", width: `${Math.min(pct, 100)}%`, transition: "width 0.5s" }} />
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* Rate Analysis */}
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💡 Rate Analysis</h3>
        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 8px" }}>Current rate: <strong style={{ color: "#D6006E" }}>{formatCurrency(data.settings.hourlyRate)}/hr</strong></p>
          {totalHours > 0 && <p style={{ margin: "0 0 8px" }}>Effective rate: <strong style={{ color: totalRevenue / totalHours >= data.settings.hourlyRate ? "#059669" : "#DC2626" }}>{formatCurrency(totalRevenue / totalHours)}/hr</strong></p>}
          {avgDiff > 1 && <p style={{ margin: 0, background: "#FFF0F5", padding: 8, borderRadius: 8, fontSize: 12 }}>💡 Your estimates are off by {avgDiff.toFixed(1)}h on average. Consider adjusting base times!</p>}
        </div>
      </Card>

      {/* Feedback */}
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💬 Client Feedback</h3>
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
function Settings({ settings, updateSettings, showToast, dbConnected, setDbConnected, forceSync, syncing }) {
  const [stripeKey, setStripeKey] = useState(settings.stripeKey || "");
  const [ejsService, setEjsService] = useState(settings.emailjsServiceId || DEFAULT_EMAILJS.serviceId);
  const [ejsTemplate, setEjsTemplate] = useState(settings.emailjsTemplateId || DEFAULT_EMAILJS.templateId);
  const [ejsPublic, setEjsPublic] = useState(settings.emailjsPublicKey || DEFAULT_EMAILJS.publicKey);
  const [showEmailGuide, setShowEmailGuide] = useState(false);
  const [showDbGuide, setShowDbGuide] = useState(false);
  const [testSending, setTestSending] = useState(false);

  // Supabase config
  const supaConfig = getSupabaseConfig() || {};
  const [supaUrl, setSupaUrl] = useState(supaConfig.url || DEFAULT_SUPABASE.url || "");
  const [supaKey, setSupaKey] = useState(supaConfig.anonKey || DEFAULT_SUPABASE.anonKey || "");
  const [dbTesting, setDbTesting] = useState(false);

  // GDrive config
  const gdriveConfig = getGDriveConfig();
  const [gdriveFolderId, setGdriveFolderId] = useState(gdriveConfig.folderId || "");
  const [gdriveFolderUrl, setGdriveFolderUrl] = useState(gdriveConfig.folderUrl || "");

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

  const saveDbConfig = async () => {
    if (!supaUrl || !supaKey) return showToast("Enter both URL and key!", "error");
    const cleanUrl = supaUrl.replace(/\/$/, "");
    setDbTesting(true);
    const result = await db.testConnection({ url: cleanUrl, anonKey: supaKey });
    if (result.ok) {
      saveSupabaseConfig({ url: cleanUrl, anonKey: supaKey });
      setDbConnected(true);
      showToast("Database connected! ☁️");
    } else {
      showToast("Connection failed: " + result.error, "error");
    }
    setDbTesting(false);
  };

  const saveGDriveSettings = () => {
    // Extract folder ID from URL if pasted
    let folderId = gdriveFolderId;
    if (gdriveFolderUrl && !folderId) {
      const match = gdriveFolderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
      if (match) folderId = match[1];
    }
    saveGDriveConfig({ folderId, folderUrl: gdriveFolderUrl });
    setGdriveFolderId(folderId);
    showToast("Google Drive settings saved! 📁");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ fontFamily: "'Sora', sans-serif", fontSize: 22, fontWeight: 800, margin: 0 }}>⚙️ Settings</h2>

      {/* Database Setup */}
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>☁️ Database (Supabase)</h3>

        {dbConnected ? (
          <div style={{ background: "#ECFDF5", borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 12, color: "#059669", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>✅ Connected — data syncs automatically!</span>
            <button onClick={forceSync} disabled={syncing} style={{ background: "none", border: "1px solid #059669", borderRadius: 8, padding: "3px 10px", color: "#059669", fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: syncing ? 0.5 : 1 }}>
              {syncing ? "⏳..." : "🔄 Sync"}
            </button>
          </div>
        ) : (
          <div style={{ background: "#FFF3E0", borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 12, color: "#E65100", fontWeight: 600 }}>
            ⚠️ No database — data only saved locally in this browser
          </div>
        )}

        <Input label="Supabase Project URL" placeholder="https://xxxxx.supabase.co" value={supaUrl} onChange={(e) => setSupaUrl(e.target.value)} />
        <Input label="Anon (Public) Key" placeholder="eyJhbGci..." value={supaKey} onChange={(e) => setSupaKey(e.target.value)} />

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <GradientButton onClick={saveDbConfig} style={{ flex: 1, opacity: dbTesting ? 0.6 : 1 }}>
            {dbTesting ? "⏳ Testing..." : "🔌 Connect & Test"}
          </GradientButton>
        </div>

        <button onClick={() => setShowDbGuide(!showDbGuide)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#FF69B4", padding: 0 }}>
          {showDbGuide ? "▲ Hide setup guide" : "📖 How to set up Supabase (free, 5 min)"}
        </button>

        {showDbGuide && (
          <div style={{ background: "#FFF5F8", border: "1.5px solid #FFD6E8", borderRadius: 12, padding: 14, marginTop: 8, fontSize: 12, color: "#555", lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, color: "#D6006E", marginBottom: 6, fontSize: 13 }}>🚀 Free Supabase Setup (500MB database)</div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 1:</strong> Go to <span style={{ color: "#D6006E", fontWeight: 600 }}>supabase.com</span> → Sign up free → "New Project"
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 2:</strong> Name it "sparklespace", set a password, choose a region → Create
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 3:</strong> Go to <strong>SQL Editor</strong> → paste this and click "Run":
            </div>
            <div style={{ background: "#1a1a2e", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 10.5, color: "#A5F3FC", marginBottom: 8, whiteSpace: "pre-wrap", overflowX: "auto" }}>
{`-- Jobs table
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings table
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Photo references table
CREATE TABLE photo_refs (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL,
  space_id TEXT,
  photo_type TEXT,
  filename TEXT,
  gdrive_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (open for anon)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON app_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON photo_refs FOR ALL USING (true) WITH CHECK (true);`}
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 4:</strong> Go to <strong>Settings → API</strong> → Copy <strong>Project URL</strong> and <strong>anon public</strong> key
            </div>
            <div style={{ background: "#ECFDF5", borderRadius: 8, padding: 8, fontWeight: 600, color: "#059669" }}>
              ✅ Paste both above and click "Connect & Test"!
            </div>
          </div>
        )}
      </Card>

      {/* Google Drive Photos */}
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📁 Google Drive (Photo Storage)</h3>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
          Upload before/after photos to a Google Drive folder. The app stores the photo filename in the database so you can find it later.
        </div>
        <Input label="Google Drive Folder URL" placeholder="https://drive.google.com/drive/folders/..." value={gdriveFolderUrl} onChange={(e) => setGdriveFolderUrl(e.target.value)} />
        <Input label="Folder ID (auto-extracted)" placeholder="Auto-fills from URL above" value={gdriveFolderId} onChange={(e) => setGdriveFolderId(e.target.value)} />
        <GradientButton onClick={saveGDriveSettings}>💾 Save Drive Settings</GradientButton>
        <div style={{ fontSize: 11, color: "#888", marginTop: 8, lineHeight: 1.5 }}>
          📌 Create a folder in Google Drive called "SparkleSpace Photos" → Right-click → "Share" → Copy link → Paste above. Photos you take in the app will be named with the job/client info for easy lookup.
        </div>
      </Card>
      
      {/* Email Setup */}
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📧 Email Service (EmailJS)</h3>
        
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

        <button onClick={() => setShowEmailGuide(!showEmailGuide)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#FF69B4", padding: 0 }}>
          {showEmailGuide ? "▲ Hide setup guide" : "📖 How to set up EmailJS (free, 5 min)"}
        </button>

        {showEmailGuide && (
          <div style={{ background: "#FFF5F8", border: "1.5px solid #FFD6E8", borderRadius: 12, padding: 14, marginTop: 8, fontSize: 12, color: "#555", lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, color: "#D6006E", marginBottom: 6, fontSize: 13 }}>🚀 Free EmailJS Setup (200 emails/mo)</div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 1:</strong> Go to <span style={{ color: "#D6006E", fontWeight: 600 }}>emailjs.com</span> → Sign up free
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

Content (HTML): {{{message_html}}}`}
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
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💰 Pricing</h3>
        <Input label="Hourly Rate ($)" type="number" min="1" step="0.50" value={settings.hourlyRate} onChange={(e) => updateSettings({ hourlyRate: parseFloat(e.target.value) || DEFAULT_RATE })} />
        <div style={{ fontSize: 11, color: "#888", marginTop: -8, marginBottom: 12 }}>WA sales tax (10.25%) auto-applies for non-cash payments</div>
      </Card>
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💳 Payment Integration</h3>
        <Input label="Stripe Publishable Key" placeholder="pk_live_..." value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} />
        <GradientButton onClick={() => { updateSettings({ stripeKey }); showToast("Stripe key saved! 💳"); }}>Save Stripe Key</GradientButton>
        <div style={{ fontSize: 11, color: "#888", marginTop: 8, lineHeight: 1.5 }}>🔗 Create a free Stripe account at stripe.com to accept card payments. Venmo & Zelle tracked manually.</div>
      </Card>
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>ℹ️ About SparkleSpace</h3>
        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 8px" }}>✨ <strong>SparkleSpace by Thea</strong></p>
          <p style={{ margin: "0 0 8px" }}>Your organizing business management app! Track assessments, schedule jobs, manage clients, handle payments, and grow your business. 🌟</p>
          <p style={{ margin: 0, fontSize: 11, color: "#999" }}>v1.5 • Supabase + EmailJS • Made with 💜</p>
        </div>
      </Card>
      <Card>
        <h3 style={{ fontFamily: "'Sora', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>🗑️ Data</h3>
        <GradientButton variant="danger" onClick={() => { if (confirm("Are you sure? This will delete ALL local data!")) { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(SUPABASE_CONFIG_KEY); localStorage.removeItem(GDRIVE_CONFIG_KEY); window.location.reload(); } }}>Reset All Local Data</GradientButton>
        <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>⚠️ This clears local cache. Database data (if connected) is preserved.</div>
      </Card>
    </div>
  );
}
