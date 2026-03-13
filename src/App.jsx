import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants & Helpers ───
const WA_TAX_RATE = 0.1025;
const DEFAULT_RATE = 22;
const DEFAULT_TUTORING_RATE = 25;
const DEFAULT_TUTORING_TIERS = [
  { minutes: 45, label: "45 min", price: 20 },
  { minutes: 60, label: "1 hour", price: 30 },
];

// Calculate tutoring earning for a session based on tier or custom
function getTutoringEarning(session, settings) {
  // If session has a fixed earning already stored, use it
  if (session.earning != null) return session.earning;
  // Check tier match
  const tiers = settings?.tutoringTiers || DEFAULT_TUTORING_TIERS;
  const tier = tiers.find(t => t.minutes === session.duration);
  if (tier) return tier.price;
  // Fallback: hours × rate
  return (session.hours || 0) * (session.rate || settings?.tutoringRate || DEFAULT_TUTORING_RATE);
}
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

  // Tutoring sessions — stored in app_settings with key "tutoring_sessions"
  async loadTutoringSessions() {
    const rows = await supaFetch("app_settings?select=*&key=eq.tutoring_sessions&limit=1");
    if (rows?.[0]) return JSON.parse(rows[0].data);
    return [];
  },
  async saveTutoringSessions(sessions) {
    const payload = { key: "tutoring_sessions", data: JSON.stringify(sessions), updated_at: new Date().toISOString() };
    const existing = await supaFetch("app_settings?key=eq.tutoring_sessions&select=key");
    if (existing?.length > 0) {
      await supaFetch("app_settings?key=eq.tutoring_sessions", { method: "PATCH", body: payload });
    } else {
      await supaFetch("app_settings", { method: "POST", body: { ...payload, created_at: new Date().toISOString() } });
    }
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
    (s.title ? `<div style="font-weight:700;color:#FF0080;font-size:14px;margin-bottom:6px;">${s.title}</div>` : "") +
    `<div style="color:#444;font-size:13px;line-height:1.6;white-space:pre-line;">${s.content}</div>` +
    `</div>`
  ).join("");

  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <div style="background:linear-gradient(135deg,#FF3CAC,#FF0080);padding:20px 24px;border-radius:16px 16px 0 0;color:#fff;">
        <h1 style="margin:0;font-size:20px;">✨ SparkleSpace</h1>
        <p style="margin:4px 0 0;font-size:12px;color:#FFB3D1;">by Thea • Organization Magic</p>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 16px 16px;">
        <p style="font-size:15px;color:#333;margin:0 0 16px;">${greeting}</p>
        ${sectionHTML}
        ${cta ? `<div style="background:linear-gradient(135deg,#FFF5F9,#FFE0F0);border-radius:12px;padding:14px;text-align:center;margin:16px 0;font-size:14px;font-weight:700;color:#FF0080;">${cta}</div>` : ""}
        <div style="border-top:1px solid #eee;padding-top:16px;margin-top:16px;font-size:12px;color:#888;line-height:1.5;">
          ${footer || `✨ Thea<br>SparkleSpace Organization<br>📱 ${THEA_PHONE}<br>📧 ${THEA_EMAIL}`}
        </div>
      </div>
    </div>`;
}

const generateId = () => Math.random().toString(36).substr(2, 9);
const formatCurrency = (n) => `$${(n || 0).toFixed(2)}`;
const formatDate = (d) => {
  // For date-only strings like "2026-03-04", parse manually to avoid UTC timezone shift
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
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
  assessment: { bg: "#FFD6C0", text: "#E65100", border: "#FFB088" },
  "estimate-sent": { bg: "#FFF3E0", text: "#E65100", border: "#FFD6A5" },
  "estimate-approved": { bg: "#B8F0E0", text: "#00695C", border: "#80CBC4" },
  "schedule-sent": { bg: "#E8C5F5", text: "#6A1B9A", border: "#CE93D8" },
  scheduled: { bg: "#E8C5F5", text: "#6A1B9A", border: "#CE93D8" },
  "in-progress": { bg: "linear-gradient(135deg, #FFB3D1, #FF3CAC)", text: "#fff", border: "#FF80AB" },
  completed: { bg: "#B8F0E0", text: "#00695C", border: "#80CBC4" },
  invoiced: { bg: "#E8C5F5", text: "#6A1B9A", border: "#CE93D8" },
  paid: { bg: "linear-gradient(135deg, #B8F0E0, #34D399)", text: "#00695C", border: "#80CBC4" },
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
    // Per-space scheduling & time tracking
    scheduledDate: "",
    scheduledTime: "",
    actualHours: null,
    actualStartTime: null,
    actualEndTime: null,
    // Per-space status: pending | completed | paid
    spaceStatus: "pending",
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

// Get the best actual hours: sum of per-space actuals if any exist, else job-level actualHours
function getEffectiveActualHours(job) {
  const spaces = job.spaces || [];
  const spaceActual = spaces.reduce((sum, s) => sum + (s.actualHours || 0), 0);
  if (spaceActual > 0) return Math.round(spaceActual * 10) / 10;
  return job.actualHours || 0;
}

// Get all per-space scheduled dates for calendar/card display
function getSpaceSchedules(job) {
  const schedules = [];
  (job.spaces || []).forEach(s => {
    if (s.scheduledDate) {
      const emoji = SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦";
      schedules.push({ date: s.scheduledDate, time: s.scheduledTime || "", spaceType: s.spaceType, emoji, hours: s.estimatedHours || 0, actualHours: s.actualHours });
    }
  });
  return schedules;
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
  return { jobs: [], clients: [], settings: { hourlyRate: DEFAULT_RATE, tutoringRate: DEFAULT_TUTORING_RATE, tutoringTiers: DEFAULT_TUTORING_TIERS }, feedback: [], tutoringSessions: [] };
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
    Promise.all([db.loadJobs(), db.loadSettings(), db.loadTutoringSessions()])
      .then(([jobs, settings, tutoringSessions]) => {
        setDbConnected(true);
        setData(prev => ({
          ...prev,
          jobs: jobs.length > 0 ? jobs : prev.jobs,
          settings: settings ? { ...prev.settings, ...settings } : prev.settings,
          tutoringSessions: tutoringSessions.length > 0 ? tutoringSessions : prev.tutoringSessions,
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
        // Sync tutoring sessions
        await db.saveTutoringSessions(newData.tutoringSessions || []).catch(err => console.warn("Tutoring sync failed:", err));
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
      const [jobs, settings, tutoringSessions] = await Promise.all([db.loadJobs(), db.loadSettings(), db.loadTutoringSessions()]);
      setData(prev => ({
        ...prev,
        jobs: jobs.length > 0 ? jobs : prev.jobs,
        settings: settings ? { ...prev.settings, ...settings } : prev.settings,
        tutoringSessions: tutoringSessions.length > 0 ? tutoringSessions : prev.tutoringSessions,
      }));
      setDbConnected(true);
      showToast("Synced from database! ☁️");
    } catch (err) {
      showToast("Sync failed: " + err.message, "error");
    }
    setSyncing(false);
  };

  const openJob = (id) => { setSelectedJob(id); setCurrentView("job-detail"); };

  // Tutoring sessions
  const addTutoringSession = (session) => {
    setData((prev) => {
      const newData = { ...prev, tutoringSessions: [session, ...(prev.tutoringSessions || [])] };
      syncToSupabase(newData);
      return newData;
    });
    showToast("Tutoring session logged! 📚");
  };

  const updateTutoringSession = (id, updates) => {
    setData((prev) => {
      const newData = { ...prev, tutoringSessions: (prev.tutoringSessions || []).map(s => s.id === id ? { ...s, ...updates } : s) };
      syncToSupabase(newData);
      return newData;
    });
  };

  const deleteTutoringSession = (id) => {
    setData((prev) => ({ ...prev, tutoringSessions: (prev.tutoringSessions || []).filter(s => s.id !== id) }));
    showToast("Session deleted");
  };

  const navItems = [
    { id: "dashboard", label: "Home", emoji: "🏠" },
    { id: "jobs", label: "Jobs", emoji: "📋" },
    { id: "tutoring", label: "Tutoring", emoji: "📚" },
    { id: "calendar", label: "Calendar", emoji: "📅" },
    { id: "analytics", label: "Stats", emoji: "📊" },
    { id: "settings", label: "Settings", emoji: "⚙️" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #FFD6C0 0%, #E8C5F5 40%, #B8F0E0 100%)", fontFamily: "'Poppins', sans-serif", color: "#2D2D2D" }}>
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
      
      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: toast.type === "success" ? "#FF3CAC" : "#EF4444", color: "#fff", padding: "12px 24px", borderRadius: 20, fontWeight: 700, boxShadow: "0 8px 30px rgba(255,60,172,0.3)", animation: "slideDown 0.3s ease", fontFamily: "'Nunito', sans-serif" }}>
          ✨ {toast.msg}
        </div>
      )}

      <header style={{ background: "linear-gradient(135deg, #FF3CAC 0%, #FF0080 50%, #E040FB 100%)", padding: "14px 20px", color: "#fff", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 24px rgba(255,0,128,0.35)" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 22, fontWeight: 900, margin: 0, letterSpacing: -0.3 }}>✨ SparkleSpace</h1>
            <p style={{ fontSize: 11, margin: 0, fontWeight: 500, color: "#FFD6E8" }}>
              by Thea • Organization Magic
              {dbConnected && <span style={{ marginLeft: 6, fontSize: 9, background: "rgba(255,255,255,0.22)", padding: "2px 10px", borderRadius: 12, color: "#fff", fontWeight: 600, backdropFilter: "blur(4px)" }}>{syncing ? "⏳ syncing..." : "☁ cloud"}</span>}
            </p>
          </div>
          <button onClick={() => { setShowNewJob(true); setCurrentView("jobs"); }} style={{ background: "#fff", border: "none", borderRadius: 20, padding: "9px 20px", color: "#FF0080", fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 4px 18px rgba(255,60,172,0.25)", fontFamily: "'Nunito', sans-serif", letterSpacing: 0.2 }}>
            + New Job
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 600, margin: "0 auto", padding: "16px 16px 100px" }}>
        {currentView === "dashboard" && <Dashboard data={data} setCurrentView={setCurrentView} openJob={openJob} setShowNewJob={setShowNewJob} />}
        {currentView === "jobs" && <JobsList data={data} openJob={openJob} showNewJob={showNewJob} setShowNewJob={setShowNewJob} addJob={addJob} updateJob={updateJob} settings={data.settings} showToast={showToast} />}
        {currentView === "job-detail" && selectedJob && <JobDetail job={data.jobs.find(j => j.id === selectedJob)} allJobs={data.jobs} updateJob={updateJob} deleteJob={deleteJob} settings={data.settings} showToast={showToast} setCurrentView={setCurrentView} />}
        {currentView === "calendar" && <CalendarView data={data} openJob={openJob} />}
        {currentView === "tutoring" && <TutoringPage sessions={data.tutoringSessions || []} settings={data.settings} addSession={addTutoringSession} updateSession={updateTutoringSession} deleteSession={deleteTutoringSession} showToast={showToast} />}
        {currentView === "analytics" && <Analytics data={data} />}
        {currentView === "settings" && <Settings settings={data.settings} updateSettings={updateSettings} showToast={showToast} dbConnected={dbConnected} setDbConnected={setDbConnected} forceSync={forceSync} syncing={syncing} />}
      </main>

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(255,255,255,0.97)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,60,172,0.08)", padding: "8px 0 max(8px, env(safe-area-inset-bottom))", zIndex: 100 }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", justifyContent: "space-around" }}>
          {navItems.map((item) => (
            <button key={item.id} onClick={() => setCurrentView(item.id)} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", padding: "6px 14px", borderRadius: 16, transition: "all 0.2s", position: "relative", ...(currentView === item.id ? { transform: "scale(1.08)" } : {}) }}>
              {currentView === item.id && <div style={{ position: "absolute", top: -2, left: "50%", transform: "translateX(-50%)", width: 42, height: 42, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,60,172,0.15) 0%, transparent 70%)", animation: "navGlow 2s ease-in-out infinite" }} />}
              <span style={{ fontSize: 20, position: "relative", zIndex: 1 }}>{item.emoji}</span>
              <span style={{ fontSize: 10, fontWeight: currentView === item.id ? 700 : 500, color: currentView === item.id ? "#FF0080" : "#999", fontFamily: "'Nunito', sans-serif", position: "relative", zIndex: 1 }}>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <style>{`
        @keyframes slideDown { from { opacity: 0; transform: translate(-50%, -20px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes navGlow { 0%, 100% { opacity: 0.6; transform: translateX(-50%) scale(1); } 50% { opacity: 1; transform: translateX(-50%) scale(1.15); } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes sparkle { 0%, 100% { opacity: 0.3; transform: scale(0.8) rotate(0deg); } 50% { opacity: 1; transform: scale(1.2) rotate(15deg); } }
        @keyframes popIn { from { opacity: 0; transform: scale(0.95) translateY(16px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes floatUp { 0% { opacity: 0; transform: translateY(24px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes confettiBurst { 0% { opacity: 1; transform: scale(0); } 50% { opacity: 1; transform: scale(1.3); } 100% { opacity: 0; transform: scale(0.8) translateY(-20px); } }
        @keyframes pulseGlow { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,60,172,0.2); } 50% { box-shadow: 0 0 0 8px rgba(255,60,172,0); } }
        @keyframes gentleBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        * { box-sizing: border-box; }
        input, textarea, select { font-family: 'Poppins', sans-serif; }
        button { transition: all 0.15s ease; }
        button:active { transform: scale(1.05) !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #FFB3D1; border-radius: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Reusable UI Components ───
function Card({ children, style = {}, onClick }) {
  return (
    <div onClick={onClick} style={{ background: "#fff", borderRadius: 22, padding: 20, boxShadow: "0 4px 24px rgba(255,60,172,0.08), 0 1px 4px rgba(0,0,0,0.04)", border: "none", animation: "popIn 0.5s cubic-bezier(0.22, 1, 0.36, 1)", cursor: onClick ? "pointer" : "default", transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)", ...style }} onMouseEnter={(e) => { if (onClick) { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 8px 30px rgba(255,60,172,0.15), 0 2px 8px rgba(0,0,0,0.06)"; } }} onMouseLeave={(e) => { if (onClick) { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; } }}>
      {children}
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", marginBottom: 4, display: "block" }}>{label}</label>}
      <input {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "2px solid #FFB3D1", fontSize: 14, outline: "none", transition: "border-color 0.2s", background: "#FFF5F9", ...props.style }} onFocus={(e) => e.target.style.borderColor = "#FF3CAC"} onBlur={(e) => e.target.style.borderColor = "#FFB3D1"} />
    </div>
  );
}

function TextArea({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", marginBottom: 4, display: "block" }}>{label}</label>}
      <textarea {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "2px solid #FFB3D1", fontSize: 14, outline: "none", minHeight: 80, resize: "vertical", background: "#FFF5F9", ...props.style }} onFocus={(e) => e.target.style.borderColor = "#FF3CAC"} onBlur={(e) => e.target.style.borderColor = "#FFB3D1"} />
    </div>
  );
}

function Select({ label, options, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", marginBottom: 4, display: "block" }}>{label}</label>}
      <select {...props} style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "2px solid #FFB3D1", fontSize: 14, outline: "none", background: "#FFF5F9", cursor: "pointer", ...props.style }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function GradientButton({ children, onClick, style = {}, variant = "primary" }) {
  const styles = {
    primary: { background: "linear-gradient(135deg, #FF3CAC, #FF0080)", color: "#fff", boxShadow: "0 4px 18px rgba(255,60,172,0.3)" },
    secondary: { background: "linear-gradient(135deg, #FFD6E8, #E8C5F5)", color: "#FF0080", boxShadow: "0 4px 12px rgba(232,197,245,0.3)" },
    success: { background: "linear-gradient(135deg, #34D399, #10B981)", color: "#fff", boxShadow: "0 4px 12px rgba(16,185,129,0.3)" },
    danger: { background: "linear-gradient(135deg, #FB7185, #F43F5E)", color: "#fff", boxShadow: "0 4px 12px rgba(244,63,94,0.3)" },
  };
  return (
    <button onClick={onClick} style={{ border: "none", borderRadius: 20, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer", width: "100%", fontFamily: "'Nunito', sans-serif", letterSpacing: 0.2, ...styles[variant], ...style }}>
      {children}
    </button>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.assessment;
  const isInvoiced = status === "invoiced";
  const isPaid = status === "paid";
  const isInProgress = status === "in-progress";
  const hasGradient = c.bg.includes("gradient");
  return (
    <span style={{ background: isInvoiced ? "linear-gradient(90deg, #E8C5F5, #FFB3D1, #E8C5F5)" : c.bg, backgroundSize: isInvoiced ? "200% auto" : undefined, animation: isInvoiced ? "shimmer 3s linear infinite" : undefined, color: c.text, padding: "4px 12px", borderRadius: 20, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "'Nunito', sans-serif", boxShadow: isPaid ? "0 2px 8px rgba(52,211,153,0.3)" : isInProgress ? "0 2px 8px rgba(255,60,172,0.3)" : "none" }}>
      {isPaid && "✨ "}{status.replace(/-/g, " ")}
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
      <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", marginBottom: 8, display: "block" }}>{label}</label>
      
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
        <button onClick={openCamera} style={{ flex: 1, padding: "12px 8px", borderRadius: 14, border: "2px dashed #FF0080", background: "linear-gradient(135deg, #FFF5F9, #FFE0F0)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, color: "#FF3CAC", fontWeight: 700, gap: 4, fontFamily: "Nunito, sans-serif", transition: "all 0.2s" }}>
          <span style={{ fontSize: 26 }}>📷</span>
          Take Photo
        </button>
        <button onClick={() => galleryRef.current?.click()} style={{ flex: 1, padding: "12px 8px", borderRadius: 14, border: "2px dashed #FFB3D9", background: "linear-gradient(135deg, #FFF5FA, #FFF5F9)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, color: "#FF0080", fontWeight: 700, gap: 4, fontFamily: "Nunito, sans-serif", transition: "all 0.2s" }}>
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
          📁 Upload photos to <a href={gdriveConfig.folderUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#FF0080", fontWeight: 600 }}>Google Drive folder</a> with these names for easy lookup
          {photos.filter(p => p.descriptiveFilename).map(p => (
            <div key={p.id} style={{ fontFamily: "monospace", fontSize: 9, color: "#6B6B6B", marginTop: 2, wordBreak: "break-all" }}>📎 {p.descriptiveFilename}</div>
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
            <button onClick={stopCamera} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, padding: "8px 16px", borderRadius: 20, cursor: "pointer", fontFamily: "Nunito, sans-serif", backdropFilter: "blur(8px)" }}>✕ Close</button>
            <div style={{ color: "#FF0080", fontSize: 13, fontWeight: 700, fontFamily: "Nunito, sans-serif", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
              📸 {photoType === "before" ? "Before Photo" : photoType === "after" ? "After Photo" : photoType === "assessment" ? "Assessment" : "Snap a Pic"}
            </div>
            <button onClick={flipCamera} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 18, padding: "8px 14px", borderRadius: 20, cursor: "pointer", backdropFilter: "blur(8px)" }}>🔄</button>
          </div>

          {/* Camera feed / Preview */}
          <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {cameraError && cameraError !== "camera" ? (
              <div style={{ color: "#FF0080", textAlign: "center", padding: 32, fontFamily: "Nunito, sans-serif" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>😿</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{cameraError}</div>
                <button onClick={stopCamera} style={{ background: "#FF3CAC", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 20, fontWeight: 700, cursor: "pointer", fontFamily: "Nunito, sans-serif" }}>Go Back</button>
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
              <div style={{ position: "absolute", top: 12, right: 12, background: "linear-gradient(135deg, #FF3CAC, #FF0080)", color: "#fff", borderRadius: 16, padding: "4px 12px", fontSize: 12, fontWeight: 700, fontFamily: "Nunito, sans-serif", boxShadow: "0 2px 8px rgba(255,20,147,0.4)" }}>
                {photos.length} pic{photos.length !== 1 ? "s" : ""} ✨
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div style={{ padding: "16px 24px 32px", background: "rgba(0,0,0,0.7)", display: "flex", justifyContent: "center", alignItems: "center", gap: 24 }}>
            {capturedPreview ? (
              <>
                <button onClick={retakePhoto} style={{ background: "rgba(255,255,255,0.15)", border: "2px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: 14, fontWeight: 700, padding: "14px 28px", borderRadius: 28, cursor: "pointer", fontFamily: "Nunito, sans-serif", backdropFilter: "blur(8px)" }}>
                  🔄 Retake
                </button>
                <button onClick={acceptPhoto} style={{ background: "linear-gradient(135deg, #FF3CAC, #FF0080)", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, padding: "14px 28px", borderRadius: 28, cursor: "pointer", fontFamily: "Nunito, sans-serif", boxShadow: "0 4px 16px rgba(255,20,147,0.5)" }}>
                  ✅ Use This!
                </button>
              </>
            ) : (
              <>
                {/* Shutter button */}
                <button onClick={capturePhoto} style={{ width: 72, height: 72, borderRadius: "50%", border: "4px solid #FF0080", background: "radial-gradient(circle, #fff 60%, #FFE0F0 100%)", cursor: "pointer", boxShadow: "0 0 20px rgba(255,105,180,0.5), inset 0 0 8px rgba(255,20,147,0.2)", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.1s" }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #FF3CAC, #FF0080)", boxShadow: "inset 0 2px 4px rgba(255,255,255,0.3)" }} />
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
function SpaceEditorCard({ space, index, total, onUpdate, onRemove, collapsed, onToggle, jobName, showTimeTracking, settings }) {
  const emoji = SPACE_TYPES.find(t => t.label === space.spaceType)?.emoji || "📦";
  const hours = estimateSpaceHours(space.spaceType, space.size, space.clutterLevel);

  // Sync estimated hours when space type/size/clutter change (only if not manually overridden)
  const prevTypeRef = useRef(space.spaceType);
  const prevSizeRef = useRef(space.size);
  const prevClutterRef = useRef(space.clutterLevel);
  useEffect(() => {
    // Only fire when type, size, or clutter actually changed (not on every render)
    if (prevTypeRef.current === space.spaceType && prevSizeRef.current === space.size && prevClutterRef.current === space.clutterLevel) return;
    prevTypeRef.current = space.spaceType;
    prevSizeRef.current = space.size;
    prevClutterRef.current = space.clutterLevel;
    if (!space._manualOverride) {
      const autoHours = estimateSpaceHours(space.spaceType, space.size, space.clutterLevel);
      if (space.estimatedHours !== autoHours) {
        onUpdate({ ...space, estimatedHours: autoHours });
      }
    }
  });

  // Batch update: sets multiple fields at once to avoid stale state issues
  const updateFields = (changes) => {
    onUpdate({ ...space, ...changes });
  };

  const updateField = (key, value) => {
    const updated = { ...space, [key]: value };
    if (key === "estimatedHours") updated._manualOverride = true;
    onUpdate(updated);
  };

  // Per-space actual hours calculation from start/end
  const calcSpaceActual = () => {
    if (space.actualStartTime && space.actualEndTime) {
      return Math.round((new Date(space.actualEndTime) - new Date(space.actualStartTime)) / 3600000 * 10) / 10;
    }
    return space.actualHours || null;
  };

  return (
    <div style={{ background: "#fff", border: "2px solid #FFB3D1", borderRadius: 16, marginBottom: 10, overflow: "hidden", animation: "fadeIn 0.3s ease" }}>
      {/* Collapsed header — always visible */}
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer", background: collapsed ? (space.spaceStatus === "paid" ? "#ECFDF5" : space.spaceStatus === "completed" ? "#F0FDF4" : "#FFF5F9") : "linear-gradient(135deg, #FFF5F9, #FFE0F0)" }}>
        <span style={{ fontSize: 22 }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {space.spaceType}
            <span style={{ fontWeight: 500, color: "#FF3CAC", fontSize: 11 }}>
              {space.estimatedHours || hours}h est.
            </span>
            {space.actualHours != null && (
              <span style={{ fontWeight: 600, color: "#059669", fontSize: 11 }}>
                • {space.actualHours}h actual
              </span>
            )}
            {space.spaceStatus === "completed" && (
              <span style={{ fontSize: 9, background: "#B8F0E0", color: "#00695C", padding: "2px 8px", borderRadius: 10, fontWeight: 800, textTransform: "uppercase" }}>✅ done</span>
            )}
            {space.spaceStatus === "paid" && (
              <span style={{ fontSize: 9, background: "linear-gradient(135deg, #B8F0E0, #34D399)", color: "#00695C", padding: "2px 8px", borderRadius: 10, fontWeight: 800, textTransform: "uppercase" }}>💰 paid</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#6B6B6B" }}>
            {space.size} • {space.clutterLevel} clutter
            {space.scheduledDate && <span style={{ color: "#FF3CAC", fontWeight: 600 }}> • 📅 {formatDate(space.scheduledDate)}</span>}
          </div>
        </div>
        <span style={{ fontSize: 11, color: "#FF0080", fontWeight: 700 }}>{collapsed ? "▼" : "▲"}</span>
        {total > 1 && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 8, padding: "4px 8px", fontSize: 11, color: "#E11D48", fontWeight: 700, cursor: "pointer" }}>
            ✕
          </button>
        )}
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div style={{ padding: "0 14px 14px" }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#6B6B6B", marginBottom: 6, display: "block", marginTop: 10 }}>Space Type</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
            {SPACE_TYPES.map((t) => (
              <button key={t.label} onClick={() => updateFields({ spaceType: t.label, _manualOverride: false })} style={{ padding: "8px 6px", borderRadius: 10, border: space.spaceType === t.label ? "2px solid #FF0080" : "1.5px solid #E5E7EB", background: space.spaceType === t.label ? "#FFE0F0" : "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                <span style={{ fontSize: 16, display: "block" }}>{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 11, fontWeight: 600, color: "#6B6B6B", marginBottom: 6, display: "block" }}>Size</label>
          <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
            {Object.keys(SIZE_MULTIPLIERS).map((s) => (
              <button key={s} onClick={() => updateFields({ size: s, _manualOverride: false })} style={{ flex: 1, padding: "7px 3px", borderRadius: 8, border: space.size === s ? "2px solid #FF0080" : "1.5px solid #E5E7EB", background: space.size === s ? "#FFE0F0" : "#fff", cursor: "pointer", fontSize: 10, fontWeight: 600, textTransform: "capitalize" }}>
                {s === "xlarge" ? "XL" : s}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 11, fontWeight: 600, color: "#6B6B6B", marginBottom: 6, display: "block" }}>Clutter Level</label>
          <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
            {Object.keys(CLUTTER_MULTIPLIERS).map((c) => (
              <button key={c} onClick={() => updateFields({ clutterLevel: c, _manualOverride: false })} style={{ flex: 1, padding: "7px 3px", borderRadius: 8, border: space.clutterLevel === c ? "2px solid #FF0080" : "1.5px solid #E5E7EB", background: space.clutterLevel === c ? "#FFE0F0" : "#fff", cursor: "pointer", fontSize: 10, fontWeight: 600, textTransform: "capitalize" }}>
                {c}
              </button>
            ))}
          </div>

          <TextArea label="Notes for this space" placeholder="What needs to be done here?" value={space.notes || ""} onChange={(e) => updateField("notes", e.target.value)} />
          
          <PhotoUpload label="📸 Before Photos" photos={space.beforePhotos || []} onPhotosChange={(p) => updateField("beforePhotos", p)} jobName={jobName} spaceType={space.spaceType} photoType="before" />

          {/* Per-space estimate with override */}
          <div style={{ background: "linear-gradient(135deg, #FFF5F9, #FFE0F0)", borderRadius: 16, padding: 12, marginTop: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "#6B6B6B" }}>🤖 Auto: {hours}h</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#6B6B6B" }}>Override:</span>
                <input type="number" step="0.5" min="0" value={space.estimatedHours || hours} onChange={(e) => updateField("estimatedHours", parseFloat(e.target.value) || 0)} style={{ width: 60, padding: "4px 8px", borderRadius: 8, border: "1.5px solid #FFB3D9", fontSize: 12, textAlign: "center", outline: "none", background: "#fff" }} />
                <span style={{ fontSize: 11, color: "#6B6B6B" }}>h</span>
              </div>
            </div>
          </div>

          {/* Per-space scheduling & actual time (only in JobDetail) */}
          {showTimeTracking && (
            <div style={{ background: "linear-gradient(135deg, #EFF6FF, #E8C5F5)", borderRadius: 16, padding: 12, marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6A1B9A", marginBottom: 8 }}>📅 Schedule & Time for this space</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "#6B6B6B", display: "block", marginBottom: 3 }}>Scheduled Date</label>
                  <input type="date" value={space.scheduledDate || ""} onChange={(e) => updateField("scheduledDate", e.target.value)} style={{ width: "100%", padding: "7px 8px", borderRadius: 10, border: "1.5px solid #CE93D8", fontSize: 12, outline: "none", background: "#fff" }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "#6B6B6B", display: "block", marginBottom: 3 }}>Start Time</label>
                  <input type="time" value={space.scheduledTime || ""} onChange={(e) => updateField("scheduledTime", e.target.value)} style={{ width: "100%", padding: "7px 8px", borderRadius: 10, border: "1.5px solid #CE93D8", fontSize: 12, outline: "none", background: "#fff" }} />
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#059669", marginBottom: 6, marginTop: 4 }}>⏱️ Actual Time Worked</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "#6B6B6B", display: "block", marginBottom: 3 }}>Start</label>
                  <input type="datetime-local" value={space.actualStartTime || ""} onChange={(e) => {
                    const v = e.target.value || null;
                    const updated = { ...space, actualStartTime: v };
                    if (v && space.actualEndTime) { updated.actualHours = Math.round((new Date(space.actualEndTime) - new Date(v)) / 3600000 * 10) / 10; }
                    onUpdate(updated);
                  }} style={{ width: "100%", padding: "7px 6px", borderRadius: 10, border: "1.5px solid #80CBC4", fontSize: 11, outline: "none", background: "#fff" }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "#6B6B6B", display: "block", marginBottom: 3 }}>End</label>
                  <input type="datetime-local" value={space.actualEndTime || ""} onChange={(e) => {
                    const v = e.target.value || null;
                    const updated = { ...space, actualEndTime: v };
                    if (v && space.actualStartTime) { updated.actualHours = Math.round((new Date(v) - new Date(space.actualStartTime)) / 3600000 * 10) / 10; }
                    onUpdate(updated);
                  }} style={{ width: "100%", padding: "7px 6px", borderRadius: 10, border: "1.5px solid #80CBC4", fontSize: 11, outline: "none", background: "#fff" }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "#6B6B6B" }}>Actual hours:</label>
                <input type="number" step="0.5" min="0" value={space.actualHours != null ? space.actualHours : ""} onChange={(e) => updateField("actualHours", e.target.value ? parseFloat(e.target.value) : null)} placeholder="auto or manual" style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1.5px solid #80CBC4", fontSize: 12, outline: "none", background: "#fff" }} />
                {space.actualHours != null && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#059669" }}>= {formatCurrency((space.actualHours || 0) * (settings?.hourlyRate || DEFAULT_RATE))}</span>
                )}
              </div>

              {/* Per-space status actions */}
              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                {(!space.spaceStatus || space.spaceStatus === "pending") && (
                  <button onClick={(e) => { e.stopPropagation(); onUpdate({ ...space, spaceStatus: "completed", completedAt: new Date().toISOString(), actualHours: space.actualHours || space.estimatedHours || hours }); }} style={{ flex: 1, background: "linear-gradient(135deg, #34D399, #10B981)", border: "none", borderRadius: 12, padding: "9px", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "'Nunito', sans-serif", boxShadow: "0 2px 8px rgba(16,185,129,0.25)" }}>
                    ✅ Mark Space Complete
                  </button>
                )}
                {space.spaceStatus === "completed" && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); onUpdate({ ...space, spaceStatus: "paid", paidAt: new Date().toISOString() }); }} style={{ flex: 1, background: "linear-gradient(135deg, #FF3CAC, #FF0080)", border: "none", borderRadius: 12, padding: "9px", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "'Nunito', sans-serif", boxShadow: "0 2px 8px rgba(255,60,172,0.25)" }}>
                      💰 Mark Space Paid
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onUpdate({ ...space, spaceStatus: "pending", completedAt: null }); }} style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 12, padding: "9px 12px", color: "#E11D48", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "'Nunito', sans-serif" }}>
                      ↩ Undo
                    </button>
                  </>
                )}
                {space.spaceStatus === "paid" && (
                  <div style={{ flex: 1, background: "linear-gradient(135deg, #ECFDF5, #D1FAE5)", borderRadius: 12, padding: "9px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#059669" }}>
                    ✨ Paid {space.paidAt ? `on ${formatDate(space.paidAt.split("T")[0])}` : ""}
                  </div>
                )}
              </div>
            </div>
          )}
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
        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B" }}>📅 Schedule Days</label>
        <span style={{ fontSize: 11, color: "#FF3CAC", fontWeight: 700 }}>{scheduledH}h of {totalHours}h</span>
      </div>
      
      <div style={{ marginBottom: 10 }}>
        <div style={{ height: 8, borderRadius: 4, background: "#FFE0F0", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 4, background: pct >= 100 ? "linear-gradient(90deg, #34D399, #60A5FA)" : "linear-gradient(90deg, #FF3CAC, #FF0080)", width: `${pct}%`, transition: "width 0.4s" }} />
        </div>
        <div style={{ fontSize: 11, color: remaining > 0 ? "#E11D48" : "#059669", fontWeight: 600, marginTop: 3 }}>
          {remaining > 0 ? `${remaining}h still needs scheduling` : "✅ All hours scheduled!"}
        </div>
      </div>

      {scheduleDays.map((day, index) => (
        <div key={day.id} style={{ background: "#FFF5F9", border: "1.5px solid #FFB3D1", borderRadius: 14, padding: 12, marginBottom: 8, animation: "fadeIn 0.2s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#FF0080" }}>Day {index + 1} {day.date ? `• ${formatDate(day.date)}` : ""}</span>
            <button onClick={() => removeDay(index)} style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: 8, padding: "3px 8px", fontSize: 11, color: "#E11D48", fontWeight: 700, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#6B6B6B", display: "block", marginBottom: 3 }}>Date</label>
              <input type="date" value={day.date} onChange={(e) => updateDay(index, { date: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #FFB3D1", fontSize: 13, outline: "none", background: "#fff" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "#6B6B6B", display: "block", marginBottom: 3 }}>Start Time</label>
              <input type="time" value={day.startTime} onChange={(e) => updateDay(index, { startTime: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #FFB3D1", fontSize: 13, outline: "none", background: "#fff" }} />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: "#6B6B6B", display: "block", marginBottom: 3 }}>Hours Thea will work this day</label>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[1, 1.5, 2, 3, 4, 5, 6, 8].map(h => (
                <button key={h} onClick={() => updateDay(index, { hours: h })} style={{ padding: "5px 10px", borderRadius: 8, border: day.hours === h ? "2px solid #FF0080" : "1.5px solid #E5E7EB", background: day.hours === h ? "#FFE0F0" : "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, color: day.hours === h ? "#FF0080" : "#666" }}>
                  {h}h
                </button>
              ))}
            </div>
            <input type="number" step="0.5" min="0.5" max="12" placeholder="Custom hours" value={day.hours || ""} onChange={(e) => updateDay(index, { hours: parseFloat(e.target.value) || 0 })} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #FFB3D1", fontSize: 12, outline: "none", background: "#fff", marginTop: 6 }} />
          </div>
        </div>
      ))}

      <button onClick={addDay} style={{ width: "100%", padding: "11px", borderRadius: 12, border: "2px dashed #FF0080", background: "linear-gradient(135deg, #FFF5F9, #FFE0F0)", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#FF0080", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        ➕ Add a Day
      </button>
    </div>
  );
}

// ─── Dashboard ───
function Dashboard({ data, setCurrentView, openJob, setShowNewJob }) {
  const cleaningRevenue = data.jobs.filter((j) => j.status === "paid").reduce((s, j) => {
    return s + (j.estimatedHours || 0) * (data.settings?.hourlyRate || DEFAULT_RATE);
  }, 0);
  const tutoringRevenue = (data.tutoringSessions || []).reduce((s, t) => s + getTutoringEarning(t, data.settings), 0);
  const totalRevenue = cleaningRevenue + tutoringRevenue;
  const uniqueStudents = [...new Set((data.tutoringSessions || []).map(t => t.student?.toLowerCase().trim()).filter(Boolean))];

  const stats = {
    active: data.jobs.filter((j) => ["assessment", "estimate-sent", "estimate-approved", "schedule-sent", "scheduled", "in-progress"].includes(j.status)).length,
    completed: data.jobs.filter((j) => j.status === "completed" || j.status === "paid").length,
    pending: data.jobs.filter((j) => j.status === "invoiced").reduce((s, j) => s + (j.invoiceAmount || 0), 0),
  };

  const upcoming = data.jobs.filter((j) => j.status === "scheduled" && j.scheduledDate).sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate)).slice(0, 3);
  const needsAction = data.jobs.filter((j) => ["assessment", "estimate-sent", "estimate-approved", "schedule-sent", "in-progress"].includes(j.status)).slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Greeting Card with flat illustration */}
      <Card style={{ background: "linear-gradient(135deg, #FF3CAC 0%, #FF0080 60%, #E040FB 100%)", color: "#fff", border: "none", position: "relative", overflow: "hidden", padding: "28px 20px 22px" }}>
        {/* Decorative blobs */}
        <div style={{ position: "absolute", top: -30, right: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
        <div style={{ position: "absolute", bottom: -20, left: -15, width: 70, height: 70, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
        <div style={{ position: "absolute", top: 50, right: 40, width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
        {/* Sparkle accents */}
        <div style={{ position: "absolute", top: 14, right: 18, fontSize: 22, opacity: 0.5, animation: "sparkle 2s ease-in-out infinite" }}>✨</div>
        <div style={{ position: "absolute", top: 44, right: 56, fontSize: 14, opacity: 0.35, animation: "sparkle 2.5s ease-in-out infinite 0.5s" }}>⭐</div>
        <div style={{ position: "absolute", bottom: 44, right: 22, fontSize: 12, opacity: 0.3, animation: "sparkle 3s ease-in-out infinite 1s" }}>💖</div>
        <div style={{ position: "absolute", top: 20, left: "40%", fontSize: 10, opacity: 0.2, animation: "sparkle 2.8s ease-in-out infinite 0.3s" }}>✦</div>
        {/* Flat illustration — girl with clipboard */}
        <svg style={{ position: "absolute", bottom: 0, right: 6, opacity: 0.15, width: 90, height: 90 }} viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="25" r="14" fill="#fff"/>
          <path d="M50 39c-12 0-20 8-20 20v12c0 2 1 3 3 3h34c2 0 3-1 3-3V59c0-12-8-20-20-20z" fill="#fff"/>
          <rect x="38" y="42" width="24" height="30" rx="3" fill="rgba(255,255,255,0.5)"/>
          <rect x="42" y="48" width="16" height="2" rx="1" fill="#FF3CAC"/>
          <rect x="42" y="53" width="12" height="2" rx="1" fill="#FF3CAC"/>
          <rect x="42" y="58" width="14" height="2" rx="1" fill="#FF3CAC"/>
          <circle cx="30" cy="14" r="3" fill="rgba(255,255,255,0.4)"/>
          <circle cx="72" cy="18" r="2" fill="rgba(255,255,255,0.3)"/>
          <path d="M35 10l2 4 4-1-3 3 2 4-4-2-4 2 2-4-3-3 4 1z" fill="rgba(255,255,255,0.35)"/>
          <path d="M68 8l1.5 3 3-.8-2.2 2.2 1.5 3-3-1.5-3 1.5 1.5-3-2.2-2.2 3 .8z" fill="rgba(255,255,255,0.25)"/>
        </svg>
        <h2 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 26, fontWeight: 900, margin: "0 0 4px", position: "relative", zIndex: 1, textShadow: "0 2px 12px rgba(0,0,0,0.1)" }}>Hey Thea! 👋</h2>
        <p style={{ fontSize: 13, color: "#FFD6E8", margin: "0 0 18px", fontWeight: 500, position: "relative", zIndex: 1, lineHeight: 1.5 }}>Ready to make some spaces sparkle today? ✨</p>
        <div style={{ display: "flex", gap: 8, position: "relative", zIndex: 1 }}>
          <button onClick={() => { setShowNewJob(true); setCurrentView("jobs"); }} style={{ flex: 1, background: "#fff", border: "none", borderRadius: 20, padding: "12px", color: "#FF0080", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "'Nunito', sans-serif", boxShadow: "0 4px 20px rgba(255,0,128,0.3)" }}>✨ New Assessment</button>
          <button onClick={() => setCurrentView("calendar")} style={{ flex: 1, background: "rgba(255,255,255,0.2)", border: "2px solid rgba(255,255,255,0.3)", borderRadius: 20, padding: "12px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Nunito', sans-serif", backdropFilter: "blur(10px)" }}>📅 My Calendar</button>
        </div>
      </Card>

      {/* Income Breakdown */}
      <Card style={{ background: "linear-gradient(135deg, #FFF5F9, #FFE0F0, #E8C5F5)", border: "none", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 15, fontWeight: 800, margin: 0, color: "#2D2D2D" }}>💰 Total Earned</h3>
          <span style={{ fontFamily: "'Nunito', sans-serif", fontSize: 22, fontWeight: 900, color: "#FF0080" }}>{formatCurrency(totalRevenue)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: 14, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, marginBottom: 2 }}>🧹</div>
            <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 16, fontWeight: 900, color: "#FF3CAC" }}>{formatCurrency(cleaningRevenue)}</div>
            <div style={{ fontSize: 10, color: "#6B6B6B", fontWeight: 600 }}>Cleaning</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: 14, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, marginBottom: 2 }}>📚</div>
            <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 16, fontWeight: 900, color: "#6A1B9A" }}>{formatCurrency(tutoringRevenue)}</div>
            <div style={{ fontSize: 10, color: "#6B6B6B", fontWeight: 600 }}>Tutoring</div>
            {uniqueStudents.length > 0 && <div style={{ fontSize: 10, color: "#6A1B9A", fontWeight: 700, marginTop: 2 }}>👨‍🎓 {uniqueStudents.length} student{uniqueStudents.length !== 1 ? "s" : ""}</div>}
          </div>
        </div>
      </Card>

      {/* Stat Tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {[
          { label: "Active Jobs", value: stats.active, emoji: "🔥", color: "#FF3CAC" },
          { label: "Completed", value: stats.completed, emoji: "✅", color: "#10B981" },
          { label: "Pending", value: formatCurrency(stats.pending), emoji: "⏳", color: "#A855F7" },
        ].map((s, i) => (
          <Card key={s.label} style={{ padding: 14, textAlign: "center", animationDelay: `${i * 0.08}s` }}>
            <div style={{ fontSize: 20, marginBottom: 2 }}>{s.emoji}</div>
            <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 18, fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#6B6B6B", fontWeight: 600 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Needs Action */}
      {needsAction.length > 0 && (
        <div>
          <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 16, fontWeight: 800, color: "#2D2D2D", margin: "0 0 10px" }}>⚡ Needs Action</h3>
          {needsAction.map((job) => (
            <Card key={job.id} onClick={() => openJob(job.id)} style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #FFB3D1, #E8C5F5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{getJobEmojis(job.spaces).slice(0, 2)}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#2D2D2D" }}>{job.clientName}</div>
                    <div style={{ fontSize: 12, color: "#6B6B6B" }}>{getJobSummary(job.spaces)}</div>
                  </div>
                </div>
                <StatusBadge status={job.status} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Coming Up */}
      {upcoming.length > 0 && (
        <div>
          <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 16, fontWeight: 800, color: "#2D2D2D", margin: "0 0 10px" }}>📅 Coming Up</h3>
          {upcoming.map((job) => (
            <Card key={job.id} onClick={() => openJob(job.id)} style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #B8F0E0, #E8C5F5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{getJobEmojis(job.spaces).slice(0, 2)}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#2D2D2D" }}>{job.clientName}</div>
                    <div style={{ fontSize: 12, color: "#A855F7" }}>{formatDate(job.scheduledDate)}{job.scheduledTime ? ` • ${job.scheduledTime}` : ""}</div>
                  </div>
                </div>
                <span style={{ fontSize: 20 }}>→</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {data.jobs.length === 0 && (
        <Card style={{ textAlign: "center", padding: "44px 24px", position: "relative", overflow: "hidden" }}>
          {/* Decorative sparkle dots */}
          <div style={{ position: "absolute", top: 12, left: 20, fontSize: 16, opacity: 0.2, animation: "sparkle 2s ease-in-out infinite" }}>✨</div>
          <div style={{ position: "absolute", top: 24, right: 30, fontSize: 12, opacity: 0.15, animation: "sparkle 3s ease-in-out infinite 1s" }}>⭐</div>
          <div style={{ position: "absolute", bottom: 18, left: 40, fontSize: 10, opacity: 0.12, animation: "sparkle 2.5s ease-in-out infinite 0.5s" }}>💫</div>
          <div style={{ position: "absolute", bottom: 30, right: 24, width: 24, height: 24, borderRadius: "50%", background: "rgba(255,60,172,0.06)" }} />
          <div style={{ position: "absolute", top: 40, left: 12, width: 16, height: 16, borderRadius: "50%", background: "rgba(232,197,245,0.12)" }} />
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style={{ marginBottom: 12 }}>
            <circle cx="40" cy="40" r="36" fill="#FFF0F5" stroke="#FFB3D1" strokeWidth="2" strokeDasharray="6 4"/>
            <path d="M40 18l3 8 8-1-6 6 3 8-8-4-8 4 3-8-6-6 8 1z" fill="#FF3CAC" opacity="0.6"/>
            <rect x="28" y="38" width="24" height="22" rx="4" fill="#E8C5F5" opacity="0.5"/>
            <rect x="32" y="44" width="16" height="2" rx="1" fill="#FF3CAC" opacity="0.5"/>
            <rect x="32" y="49" width="12" height="2" rx="1" fill="#FF3CAC" opacity="0.4"/>
            <rect x="32" y="54" width="14" height="2" rx="1" fill="#FF3CAC" opacity="0.3"/>
          </svg>
          <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 20, fontWeight: 900, color: "#2D2D2D", margin: "0 0 8px" }}>Your journey starts here!</h3>
          <p style={{ fontSize: 13, color: "#6B6B6B", margin: "0 0 18px", lineHeight: 1.6 }}>Create your first job assessment to get started ✨</p>
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
          {/* Horizontally scrolling filter pills */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, marginBottom: 12, WebkitOverflowScrolling: "touch" }}>
            {["all", "assessment", "estimate-sent", "estimate-approved", "schedule-sent", "scheduled", "in-progress", "completed", "invoiced", "paid"].map((f) => (
              <button key={f} onClick={() => setFilter(f)} style={{ whiteSpace: "nowrap", padding: "7px 16px", borderRadius: 20, border: filter === f ? "none" : "2px solid #FFB3D1", background: filter === f ? "linear-gradient(135deg, #FF3CAC, #FF0080)" : "#fff", color: filter === f ? "#fff" : "#FF0080", fontWeight: 700, fontSize: 12, cursor: "pointer", textTransform: "capitalize", fontFamily: "'Nunito', sans-serif", boxShadow: filter === f ? "0 3px 12px rgba(255,60,172,0.25)" : "none", transition: "all 0.2s" }}>
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <Card style={{ textAlign: "center", padding: 30 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
              <p style={{ color: "#6B6B6B", fontSize: 13, fontWeight: 500 }}>No jobs found for this filter</p>
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
  const isCompleted = ["completed", "paid"].includes(job.status);
  return (
    <Card onClick={onClick} style={{ padding: 14, position: "relative", overflow: "hidden", ...(isCompleted ? { border: "1px solid #B8F0E0" } : {}) }}>
      {/* Confetti for completed jobs */}
      {isCompleted && (
        <>
          <div style={{ position: "absolute", top: 6, right: 60, fontSize: 10, opacity: 0.3, animation: "sparkle 2s ease-in-out infinite" }}>🎉</div>
          <div style={{ position: "absolute", bottom: 8, left: 8, fontSize: 8, opacity: 0.2, animation: "sparkle 3s ease-in-out infinite 0.5s" }}>✨</div>
        </>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {/* Client avatar circle */}
        <div style={{ width: 46, height: 46, borderRadius: "50%", background: "linear-gradient(135deg, #FFB3D1, #E8C5F5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: spaces.length > 2 ? 14 : 20, flexShrink: 0, boxShadow: "0 2px 8px rgba(255,60,172,0.15)" }}>
          {getJobEmojis(spaces)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#2D2D2D" }}>{job.clientName}</div>
            <StatusBadge status={job.status} />
          </div>
          <div style={{ fontSize: 12, color: "#6B6B6B", marginTop: 2 }}>
            {spaces.length === 1 ? spaces[0].spaceType : `${spaces.length} spaces`} • {job.estimatedHours}h est.
            {(() => { const eff = getEffectiveActualHours(job); return eff > 0 ? <span style={{ color: "#059669", fontWeight: 600 }}> • {eff}h actual</span> : null; })()}
          </div>
          {spaces.length > 1 && (
            <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
              {spaces.map(s => (
                <span key={s.id} style={{ fontSize: 9, background: "#E8C5F5", color: "#6A1B9A", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>
                  {SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji} {s.spaceType}
                  {s.estimatedHours ? ` ${s.estimatedHours}h` : ""}
                  {s.actualHours != null ? ` → ${s.actualHours}h` : ""}
                </span>
              ))}
            </div>
          )}
          {/* Per-space schedules */}
          {spaces.some(s => s.scheduledDate) && (
            <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
              {spaces.filter(s => s.scheduledDate).map(s => (
                <span key={s.id} style={{ fontSize: 9, background: "#F3E8FF", color: "#6A1B9A", padding: "2px 6px", borderRadius: 6, fontWeight: 600 }}>
                  {SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji} {formatDate(s.scheduledDate)} • {s.estimatedHours || 0}h
                </span>
              ))}
            </div>
          )}
          {/* Job-level schedule days */}
          {job.scheduleDays && job.scheduleDays.length > 0 ? (
            <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
              {job.scheduleDays.filter(d => d.date).map((d, i) => (
                <span key={d.id || i} style={{ fontSize: 9, background: "#EFF6FF", color: "#2563EB", padding: "2px 6px", borderRadius: 6, fontWeight: 600 }}>
                  📅 {formatDate(d.date)} • {d.hours}h
                </span>
              ))}
            </div>
          ) : job.scheduledDate && !spaces.some(s => s.scheduledDate) ? (
            <div style={{ fontSize: 11, color: "#FF3CAC", fontWeight: 600, marginTop: 3 }}>📅 {formatDate(job.scheduledDate)}</div>
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
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: i < step ? "linear-gradient(90deg, #FF3CAC, #FF0080)" : "#E5E7EB", transition: "all 0.3s" }} />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 20, fontWeight: 800, margin: 0 }}>
          {step === 1 && "👤 Client Info"}
          {step === 2 && "🏠 Spaces to Organize"}
          {step === 3 && "📅 Scheduling"}
          {step === 4 && "💰 Estimate"}
        </h2>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6B6B6B" }}>✕</button>
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
          <div style={{ background: "linear-gradient(135deg, #FFF5F9, #FFE0F0, #EFF6FF)", borderRadius: 14, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#2D2D2D" }}>{spaces.length} space{spaces.length > 1 ? "s" : ""}</span>
              <span style={{ fontSize: 12, color: "#6B6B6B", marginLeft: 8 }}>
                {getJobEmojis(spaces)}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#FF0080" }}>
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

          <button onClick={addSpace} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "2px dashed #FF0080", background: "linear-gradient(135deg, #FFF5F9, #FFE0F0)", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#FF0080", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}>
            ➕ Add Another Space
          </button>

          <TextArea label="General Job Notes" placeholder="Any overall notes for this job?" value={form.notes} onChange={(e) => update("notes", e.target.value)} style={{ marginTop: 14 }} />
        </div>
      )}

      {/* Step 3: Scheduling */}
      {step === 3 && (
        <div>
          <Card style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", marginBottom: 8, display: "block" }}>Client's Available Days</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {DAYS_OF_WEEK.map((d) => (
                <button key={d} onClick={() => { const arr = form.preferredDays.includes(d) ? form.preferredDays.filter(x => x !== d) : [...form.preferredDays, d]; update("preferredDays", arr); }} style={{ padding: "8px 12px", borderRadius: 10, border: form.preferredDays.includes(d) ? "2px solid #34D399" : "2px solid #E5E7EB", background: form.preferredDays.includes(d) ? "#ECFDF5" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: form.preferredDays.includes(d) ? "#059669" : "#666" }}>
                  {d}
                </button>
              ))}
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", marginBottom: 8, display: "block" }}>Preferred Times</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {TIME_SLOTS.map((t) => (
                <button key={t} onClick={() => { const arr = form.preferredTimes.includes(t) ? form.preferredTimes.filter(x => x !== t) : [...form.preferredTimes, t]; update("preferredTimes", arr); }} style={{ padding: "8px 12px", borderRadius: 10, border: form.preferredTimes.includes(t) ? "2px solid #60A5FA" : "2px solid #E5E7EB", background: form.preferredTimes.includes(t) ? "#EFF6FF" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: form.preferredTimes.includes(t) ? "#2563EB" : "#666" }}>
                  {t}
                </button>
              ))}
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", marginBottom: 8, display: "block" }}>Days That DON'T Work</label>
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
          <div style={{ background: "linear-gradient(135deg, #FFF5F9, #FFE0F0, #EFF6FF)", borderRadius: 16, padding: 16, marginTop: 8 }}>
            <h4 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💎 Estimate Breakdown</h4>
            
            {/* Per-space breakdown */}
            {spaces.map((s, i) => {
              const emoji = SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦";
              const hrs = s.estimatedHours || estimateSpaceHours(s.spaceType, s.size, s.clutterLevel);
              return (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, padding: "4px 0", borderBottom: i < spaces.length - 1 ? "1px solid rgba(192,132,252,0.15)" : "none" }}>
                  <span style={{ color: "#6B6B6B" }}>{emoji} {s.spaceType} ({hrs}h)</span>
                  <span style={{ fontWeight: 600 }}>{formatCurrency(hrs * settings.hourlyRate)}</span>
                </div>
              );
            })}

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8, paddingTop: 8, borderTop: "1.5px solid rgba(192,132,252,0.2)" }}>
              <span style={{ color: "#6B6B6B" }}>Subtotal ({totalHours}h × {formatCurrency(settings.hourlyRate)}/hr)</span>
              <span style={{ fontWeight: 700 }}>{formatCurrency(totalCost)}</span>
            </div>

            {form.discountType !== "none" && form.discountValue > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#E11D48", marginTop: 4 }}>
                <span>Discount ({form.discountType === "percent" ? `${form.discountValue}%` : formatCurrency(form.discountValue)})</span>
                <span>-{formatCurrency(form.discountType === "percent" ? totalCost * form.discountValue / 100 : form.discountValue)}</span>
              </div>
            )}
            {form.paymentMethod !== "cash" && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B6B6B", marginTop: 4 }}>
                <span>WA Sales Tax (10.25%)</span>
                <span>+{formatCurrency((totalCost - (form.discountType === "percent" ? totalCost * form.discountValue / 100 : form.discountType === "dollar" ? form.discountValue : 0)) * WA_TAX_RATE)}</span>
              </div>
            )}
            <div style={{ borderTop: "2px solid rgba(192,132,252,0.25)", paddingTop: 10, marginTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 800, fontFamily: "'Nunito', sans-serif", fontSize: 16 }}>Total</span>
              <span style={{ fontWeight: 800, fontFamily: "'Nunito', sans-serif", fontSize: 20, color: "#FF0080" }}>{formatCurrency(calculateTotal())}</span>
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
function JobDetail({ job, allJobs, updateJob, deleteJob, settings, showToast, setCurrentView }) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [expandedSpace, setExpandedSpace] = useState(-1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Manual time entry
  const [showManualTime, setShowManualTime] = useState(false);
  const [manualStartDate, setManualStartDate] = useState("");
  const [manualStartTime, setManualStartTime] = useState("");
  const [manualEndDate, setManualEndDate] = useState("");
  const [manualEndTime, setManualEndTime] = useState("");
  // Edit contact
  const [showEditContact, setShowEditContact] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  // Combined invoice
  const [showCombinedInvoice, setShowCombinedInvoice] = useState(false);
  // Invoice preview (editable amount before submitting)
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [invoiceEditAmount, setInvoiceEditAmount] = useState(0);

  if (!job) return <Card><p>Job not found</p></Card>;

  const spaces = job.spaces || [];

  const updateSpace = (index, updated) => {
    const newSpaces = [...spaces];
    newSpaces[index] = updated;
    const newHours = totalSpacesHours(newSpaces);
    const jobUpdates = { spaces: newSpaces, estimatedHours: newHours, estimatedCost: newHours * settings.hourlyRate };

    // Auto-promote job status based on per-space statuses
    const allStatuses = newSpaces.map(s => s.spaceStatus || "pending");
    const allCompleted = allStatuses.every(s => s === "completed" || s === "paid");
    const allPaid = allStatuses.every(s => s === "paid");

    if (allPaid && job.status !== "paid") {
      jobUpdates.status = "paid";
      jobUpdates.paidAt = new Date().toISOString();
      jobUpdates.actualHours = newSpaces.reduce((sum, s) => sum + (s.actualHours || s.estimatedHours || 0), 0);
      // Bill on estimated hours (actual is for tracking only)
      const estTotal = newSpaces.reduce((sum, s) => sum + (s.estimatedHours || 0), 0);
      jobUpdates.finalAmount = estTotal * settings.hourlyRate;
      showToast("All spaces paid! Job marked paid 💰");
    } else if (allCompleted && !allPaid && !["completed", "invoiced", "paid"].includes(job.status)) {
      jobUpdates.status = "completed";
      jobUpdates.completedAt = new Date().toISOString();
      jobUpdates.actualHours = newSpaces.reduce((sum, s) => sum + (s.actualHours || s.estimatedHours || 0), 0);
      showToast("All spaces complete! Job marked completed ✅");
    }

    updateJob(job.id, jobUpdates);
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
    updateJob(job.id, { actualEndTime: end, actualHours: hours, status: "completed", completedAt: end });
    showToast(`Done! ${hours}h logged ✅`);
  };

  const markComplete = () => {
    const now = new Date().toISOString();
    updateJob(job.id, {
      status: "completed",
      completedAt: now,
      actualEndTime: job.actualEndTime || now,
      actualHours: job.actualHours || job.estimatedHours || 0,
    });
    showToast("Job marked complete! ✅");
  };

  const handleDeleteJob = () => {
    deleteJob(job.id);
    setCurrentView("jobs");
  };

  // Manual time entry — save start/end times manually
  const saveManualTime = () => {
    if (!manualStartDate || !manualStartTime) return showToast("Enter at least a start date & time", "error");
    const startISO = new Date(`${manualStartDate}T${manualStartTime}`).toISOString();
    const updates = { actualStartTime: startISO, status: job.status === "scheduled" ? "in-progress" : job.status };
    if (manualEndDate && manualEndTime) {
      const endISO = new Date(`${manualEndDate}T${manualEndTime}`).toISOString();
      const hours = Math.round((new Date(endISO) - new Date(startISO)) / 3600000 * 10) / 10;
      if (hours <= 0) return showToast("End time must be after start time", "error");
      updates.actualEndTime = endISO;
      updates.actualHours = hours;
      updates.status = "completed";
      updates.completedAt = endISO;
    }
    updateJob(job.id, updates);
    setShowManualTime(false);
    showToast(updates.actualEndTime ? `Logged ${updates.actualHours}h ✅` : "Start time saved! ⏱️");
  };

  // Open edit contact modal with current values
  const openEditContact = () => {
    setEditName(job.clientName || "");
    setEditPhone(job.clientPhone || "");
    setEditEmail(job.clientEmail || "");
    setEditAddress(job.clientAddress || "");
    setShowEditContact(true);
  };

  const saveContact = () => {
    if (!editName.trim()) return showToast("Name is required", "error");
    updateJob(job.id, { clientName: editName.trim(), clientPhone: editPhone.trim(), clientEmail: editEmail.trim(), clientAddress: editAddress.trim() });
    setShowEditContact(false);
    showToast("Contact updated! ✏️");
  };

  // Combined invoice — find same-client completed jobs
  const sameClientJobs = (allJobs || []).filter(j =>
    j.clientName?.toLowerCase().trim() === job.clientName?.toLowerCase().trim() &&
    j.id !== job.id &&
    ["completed", "invoiced"].includes(j.status)
  );

  const generateCombinedInvoice = (selectedJobIds, overrideTotal) => {
    const jobsToInvoice = [job, ...(allJobs || []).filter(j => selectedJobIds.includes(j.id))];
    const totalAmount = overrideTotal;
    // Mark all as invoiced with combined reference
    const combinedRef = generateId();
    jobsToInvoice.forEach(j => {
      updateJob(j.id, {
        invoiceAmount: null,
        combinedInvoiceRef: combinedRef,
        combinedInvoiceTotal: totalAmount,
        combinedInvoiceJobs: jobsToInvoice.map(jj => jj.id),
        status: "invoiced",
      });
    });
    // Set the total on the current job
    updateJob(job.id, { invoiceAmount: totalAmount });
    setShowCombinedInvoice(false);
    showToast(`Combined invoice: ${formatCurrency(totalAmount)} for ${jobsToInvoice.length} jobs! 🧾`);
  };

  const openInvoicePreview = () => {
    // Bill based on ESTIMATED hours (actual is for tracking only)
    const billableHours = job.estimatedHours || 0;
    let base = billableHours * settings.hourlyRate;
    if (job.discountType === "percent") base -= base * ((job.discountValue || 0) / 100);
    else if (job.discountType === "dollar") base -= (job.discountValue || 0);
    if (job.paymentMethod !== "cash") base += base * WA_TAX_RATE;
    setInvoiceEditAmount(Math.max(0, Math.round(base * 100) / 100));
    setShowInvoicePreview(true);
  };

  const submitInvoice = () => {
    updateJob(job.id, { invoiceAmount: invoiceEditAmount, status: "invoiced" });
    setShowInvoicePreview(false);
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
      costLines += `<br><strong style="font-size:16px;color:#FF0080;">Estimated Total: ${formatCurrency(job.totalEstimate || job.estimatedCost)}</strong>`;

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
          { title: "💰 Estimated Total", content: `<strong style="font-size:16px;color:#FF0080;">${formatCurrency(job.totalEstimate || job.estimatedCost)}</strong> (${job.estimatedHours}h total)` },
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
          { title: "💰 Estimated Total", content: `<strong style="font-size:16px;color:#FF0080;">${formatCurrency(job.totalEstimate || job.estimatedCost)}</strong>` },
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

  // Sum of per-space actual hours (for invoice and display)
  const spaceActualHours = spaces.reduce((sum, s) => sum + (s.actualHours || 0), 0);
  const totalActualHours = spaceActualHours > 0 ? Math.round(spaceActualHours * 10) / 10 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <button onClick={() => setCurrentView("jobs")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 800, color: "#FF0080", textAlign: "left", padding: 0, fontFamily: "'Nunito', sans-serif" }}>← Back to Jobs</button>

      {/* Header */}
      <Card style={{ background: "linear-gradient(135deg, #FFF5F9, #FFE0F0)", border: "none", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 8, right: 12, fontSize: 18, opacity: 0.15, animation: "sparkle 2.5s ease-in-out infinite" }}>✨</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <h2 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 22, fontWeight: 900, margin: "0 0 4px", color: "#2D2D2D" }}>{job.clientName}</h2>
            <p style={{ fontSize: 13, color: "#6B6B6B", margin: 0 }}>{getJobEmojis(spaces)} {getJobSummary(spaces)} • {job.clientAddress || "No address"}</p>
            {job.clientPhone && <p style={{ fontSize: 12, color: "#FF3CAC", margin: "4px 0 0", fontWeight: 700 }}>📱 {job.clientPhone}</p>}
            {job.clientEmail && <p style={{ fontSize: 11, color: "#6B6B6B", margin: "2px 0 0" }}>📧 {job.clientEmail}</p>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <StatusBadge status={job.status} />
            <button onClick={openEditContact} style={{ background: "none", border: "1.5px solid #FFB3D1", borderRadius: 10, padding: "3px 10px", fontSize: 10, fontWeight: 700, color: "#FF0080", cursor: "pointer", fontFamily: "'Nunito', sans-serif" }}>✏️ Edit</button>
          </div>
        </div>
        {/* Space chips */}
        {spaces.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {spaces.map(s => (
              <span key={s.id} style={{ fontSize: 11, background: "#E8C5F5", color: "#6A1B9A", padding: "4px 12px", borderRadius: 14, fontWeight: 700 }}>
                {SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji} {s.spaceType} • {s.estimatedHours || estimateSpaceHours(s.spaceType, s.size, s.clutterLevel)}h
              </span>
            ))}
          </div>
        )}
        {/* Schedule days display */}
        {job.scheduleDays && job.scheduleDays.filter(d => d.date).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6B6B", marginBottom: 4 }}>📅 Schedule ({job.scheduleDays.filter(d => d.date).length} day{job.scheduleDays.filter(d => d.date).length !== 1 ? "s" : ""})</div>
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
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>⏱️ Time & Cost</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: "#FFF5F9", borderRadius: 16, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#6B6B6B", fontWeight: 600 }}>Estimated</div>
            <div style={{ fontWeight: 800, color: "#FF3CAC", fontSize: 16 }}>{job.estimatedHours}h</div>
            <div style={{ fontSize: 11, color: "#6B6B6B" }}>{formatCurrency(job.estimatedCost)}</div>
          </div>
          <div style={{ background: "#FFE0F0", borderRadius: 16, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#6B6B6B", fontWeight: 600 }}>Actual</div>
            <div style={{ fontWeight: 800, color: "#FF0080", fontSize: 16 }}>{totalActualHours ? `${totalActualHours}h` : job.actualHours ? `${job.actualHours}h` : "—"}</div>
            {(totalActualHours || job.actualHours) && <div style={{ fontSize: 11, color: "#6B6B6B" }}>{formatCurrency((totalActualHours || job.actualHours) * settings.hourlyRate)}</div>}
          </div>
        </div>

        {/* Per-space breakdown */}
        {spaces.length > 0 && (spaces.some(s => s.actualHours != null || s.scheduledDate || s.spaceStatus) || spaces.length > 1) && (
          <div style={{ marginTop: 10, background: "#FFF5F9", borderRadius: 14, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 6 }}>Per-space breakdown:</div>
            {spaces.map(s => {
              const sEmoji = SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦";
              const st = s.spaceStatus || "pending";
              return (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, padding: "4px 0", borderBottom: "1px solid rgba(255,60,172,0.08)" }}>
                  <span style={{ color: "#2D2D2D", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    {sEmoji} {s.spaceType}
                    {st === "completed" && <span style={{ fontSize: 8, background: "#B8F0E0", color: "#00695C", padding: "1px 5px", borderRadius: 6, fontWeight: 800 }}>DONE</span>}
                    {st === "paid" && <span style={{ fontSize: 8, background: "#34D399", color: "#fff", padding: "1px 5px", borderRadius: 6, fontWeight: 800 }}>PAID</span>}
                  </span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ color: "#FF3CAC" }}>Est: {s.estimatedHours || 0}h</span>
                    {s.actualHours != null && <span style={{ color: "#059669", fontWeight: 700 }}>Act: {s.actualHours}h</span>}
                    {s.scheduledDate && <span style={{ color: "#6A1B9A", fontSize: 10 }}>📅 {formatDate(s.scheduledDate)}</span>}
                  </div>
                </div>
              );
            })}
            {totalActualHours > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "1.5px solid #FFB3D1", fontSize: 12, fontWeight: 700 }}>
                <span style={{ color: "#2D2D2D" }}>Total actual</span>
                <span style={{ color: "#FF0080" }}>{totalActualHours}h = {formatCurrency(totalActualHours * settings.hourlyRate)}</span>
              </div>
            )}
          </div>
        )}

        {accuracyDiff !== null && (
          <div style={{ marginTop: 8, padding: 8, borderRadius: 10, background: accuracyDiff > 0 ? "#FFF1F2" : "#ECFDF5", textAlign: "center", fontSize: 12, fontWeight: 600, color: accuracyDiff > 0 ? "#E11D48" : "#059669" }}>
            {accuracyDiff > 0 ? `⚠️ Took ${accuracyDiff}h longer than estimated` : accuracyDiff < 0 ? `✅ Finished ${Math.abs(accuracyDiff)}h early!` : "✅ Right on time!"}
          </div>
        )}
      </Card>

      {/* Spaces (editable) */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: 0 }}>🏠 Spaces ({spaces.length})</h3>
          <button onClick={addSpaceToJob} style={{ background: "linear-gradient(135deg, #FFE0F0, #FFF5F9)", border: "1.5px solid #FFB3D9", borderRadius: 10, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: "#FF0080", cursor: "pointer" }}>
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
            showTimeTracking={true}
            settings={settings}
          />
        ))}
      </Card>

      {/* After Photos (per-space) */}
      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📸 After Photos</h3>
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
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📝 Job Notes</h3>
        <TextArea value={job.notes || ""} onChange={(e) => updateJob(job.id, { notes: e.target.value })} placeholder="Add job notes..." />
      </Card>

      {/* Actions */}
      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>⚡ Actions</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Step 1: Assessment — finalize estimate then send to client */}
          {job.status === "assessment" && (
            <>
              <div style={{ background: "linear-gradient(135deg, #FFD6C0, #FFE0F0)", borderRadius: 16, padding: 12, marginBottom: 4, fontSize: 12, color: "#E65100", fontWeight: 600 }}>
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
              <div style={{ background: "#FFE0F0", borderRadius: 16, padding: 14, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>⏳</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#F57F17" }}>Waiting for Client Approval</div>
                <div style={{ fontSize: 11, color: "#6B6B6B", marginTop: 2 }}>Sent {job.estimateSentAt ? formatDate(job.estimateSentAt) : ""}</div>
                {job.clientEmail && <div style={{ fontSize: 11, color: "#FF3CAC", marginTop: 2 }}>📧 {job.clientEmail}</div>}
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
              <div style={{ background: "#B8F0E0", borderRadius: 16, padding: 12, marginBottom: 4, fontSize: 12, color: "#2E7D32", fontWeight: 600 }}>
                ✅ Client approved the estimate! Now set up the schedule and send it.
              </div>
              <ScheduleDaysEditor
                scheduleDays={job.scheduleDays || []}
                totalHours={job.estimatedHours || 0}
                onChange={(days) => {
                  const withDates = days.filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
                  updateJob(job.id, { scheduleDays: days, scheduledDate: withDates[0]?.date || "", scheduledTime: withDates[0]?.startTime || "" });
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
              <div style={{ background: "#E8C5F5", borderRadius: 16, padding: 14, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>📅</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0277BD" }}>Waiting for Schedule Confirmation</div>
                <div style={{ fontSize: 11, color: "#6B6B6B", marginTop: 2 }}>Sent {job.scheduleSentAt ? formatDate(job.scheduleSentAt) : ""}</div>
                {(job.scheduleDays || []).filter(d => d.date).map((d, i) => (
                  <div key={d.id || i} style={{ fontSize: 11, color: "#6B6B6B", marginTop: 2 }}>
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
              <div style={{ background: "#E8C5F5", borderRadius: 16, padding: 12, marginBottom: 4, fontSize: 12, color: "#1565C0", fontWeight: 600 }}>
                🎉 Client confirmed! Ready to organize.
              </div>
              <GradientButton variant="success" onClick={startTimer}>⏱️ Start Timer</GradientButton>
              <button onClick={() => setShowManualTime(true)} style={{ background: "none", border: "1.5px solid #FFB3D1", borderRadius: 14, padding: "10px", color: "#FF0080", fontWeight: 700, fontSize: 12, cursor: "pointer", width: "100%", fontFamily: "'Nunito', sans-serif" }}>
                🕐 Enter Time Manually
              </button>
            </>
          )}

          {/* Step 6: In progress */}
          {job.status === "in-progress" && job.actualStartTime && !job.actualEndTime && (
            <>
              <div style={{ background: "#FFF5F9", borderRadius: 16, padding: 14, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: "#6B6B6B", fontWeight: 600 }}>Started at</div>
                <div style={{ fontWeight: 800, color: "#FF3CAC", fontSize: 16 }}>{formatTime(job.actualStartTime)}</div>
                <TimerDisplay startTime={job.actualStartTime} />
              </div>
              <GradientButton variant="danger" onClick={stopTimer}>⏹️ Stop Timer</GradientButton>
              <button onClick={() => { setManualStartDate(job.actualStartTime.split("T")[0]); setManualStartTime(new Date(job.actualStartTime).toTimeString().slice(0, 5)); setShowManualTime(true); }} style={{ background: "none", border: "1.5px solid #FFB3D1", borderRadius: 14, padding: "10px", color: "#FF0080", fontWeight: 700, fontSize: 12, cursor: "pointer", width: "100%", fontFamily: "'Nunito', sans-serif" }}>
                🕐 Edit Start/End Time Manually
              </button>
            </>
          )}

          {/* Step 7: Completed */}
          {job.status === "completed" && (
            <>
              <GradientButton onClick={openInvoicePreview}>🧾 Generate Invoice</GradientButton>
              {sameClientJobs.length > 0 && (
                <button onClick={() => setShowCombinedInvoice(true)} style={{ background: "none", border: "1.5px solid #E8C5F5", borderRadius: 14, padding: "10px", color: "#6A1B9A", fontWeight: 700, fontSize: 12, cursor: "pointer", width: "100%", fontFamily: "'Nunito', sans-serif" }}>
                  📋 Combined Invoice ({sameClientJobs.length + 1} jobs for {job.clientName})
                </button>
              )}
            </>
          )}

          {/* Step 8: Invoiced */}
          {job.status === "invoiced" && (
            <>
              <div style={{ background: "#FFE0F0", borderRadius: 16, padding: 14, textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: "#6B6B6B", fontWeight: 600 }}>Invoice Amount</div>
                <div style={{ fontWeight: 800, color: "#FF0080", fontSize: 22 }}>{formatCurrency(job.invoiceAmount)}</div>
                <div style={{ fontSize: 11, color: "#6B6B6B" }}>via {job.paymentMethod}</div>
              </div>
              <GradientButton variant="success" onClick={markPaid}>💰 Mark as Paid</GradientButton>
            </>
          )}

          {/* Step 9: Paid — collect feedback */}
          {job.status === "paid" && !job.feedback && (
            <GradientButton onClick={() => setShowFeedback(true)}>🌟 Collect Feedback</GradientButton>
          )}
          {job.feedback && (
            <div style={{ background: "#B8F0E0", borderRadius: 16, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#059669", marginBottom: 4 }}>Client Feedback</div>
              <div style={{ fontSize: 16, marginBottom: 4 }}>{"⭐".repeat(job.feedback.rating)}</div>
              <div style={{ fontSize: 13, color: "#2D2D2D" }}>{job.feedback.text || "No comment"}</div>
            </div>
          )}

          {/* Workflow progress tracker */}
          <div style={{ marginTop: 8, background: "linear-gradient(135deg, #FFF5F9, #FFE0F0)", borderRadius: 16, padding: 14, border: "none" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6B6B6B", marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>📍 Workflow</div>
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
                    <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, background: isCurrent ? "linear-gradient(135deg, #FF3CAC, #FF0080)" : isDone ? "#34D399" : "#E5E7EB", color: isCurrent || isDone ? "#fff" : "#999", fontWeight: 700 }}>
                      {isDone ? "✓" : s.emoji}
                    </div>
                    {i < arr.length - 1 && <div style={{ width: 10, height: 2, background: isDone ? "#34D399" : "#E5E7EB", borderRadius: 1 }} />}
                  </div>
                );
              })}
            </div>
            {/* Completed timestamp */}
            {job.completedAt && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#059669", fontWeight: 600, background: "#B8F0E0", borderRadius: 8, padding: "6px 10px", display: "inline-block" }}>
                ✅ Completed: {formatDate(job.completedAt)} at {formatTime(job.completedAt)}
              </div>
            )}
          </div>

          {/* Mark Complete — available from any pre-completion status */}
          {!["completed", "invoiced", "paid"].includes(job.status) && (
            <GradientButton variant="success" onClick={markComplete} style={{ marginTop: 4 }}>
              ✅ Mark Job as Complete
            </GradientButton>
          )}

          {/* Delete Job */}
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} style={{ marginTop: 4, background: "none", border: "2px solid #FCA5A5", borderRadius: 14, padding: "10px 20px", color: "#DC2626", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Poppins', sans-serif", width: "100%", transition: "all 0.2s" }}>
              🗑️ Delete This Job
            </button>
          ) : (
            <div style={{ marginTop: 4, background: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: 14, padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626", marginBottom: 10 }}>⚠️ Delete this job permanently?</div>
              <div style={{ fontSize: 11, color: "#6B6B6B", marginBottom: 10 }}>This will remove all data for <strong>{job.clientName}</strong> and cannot be undone.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <GradientButton variant="secondary" onClick={() => setConfirmDelete(false)} style={{ flex: 1, fontSize: 12 }}>Cancel</GradientButton>
                <GradientButton variant="danger" onClick={handleDeleteJob} style={{ flex: 1, fontSize: 12 }}>🗑️ Yes, Delete</GradientButton>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Feedback Modal */}
      {showFeedback && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <Card style={{ width: "100%", maxWidth: 400 }}>
            <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 18, fontWeight: 800, margin: "0 0 14px" }}>🌟 Client Feedback</h3>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", marginBottom: 8, display: "block" }}>Rating</label>
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

      {/* Manual Time Entry Modal */}
      {showManualTime && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <Card style={{ width: "100%", maxWidth: 400 }}>
            <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 18, fontWeight: 800, margin: "0 0 4px" }}>🕐 Enter Time Manually</h3>
            <p style={{ fontSize: 12, color: "#6B6B6B", margin: "0 0 14px", lineHeight: 1.5 }}>Set the actual start and end times for this job. Leave end time empty to just record the start.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Input label="Start Date *" type="date" value={manualStartDate} onChange={(e) => setManualStartDate(e.target.value)} />
              <Input label="Start Time *" type="time" value={manualStartTime} onChange={(e) => setManualStartTime(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Input label="End Date" type="date" value={manualEndDate} onChange={(e) => setManualEndDate(e.target.value)} />
              <Input label="End Time" type="time" value={manualEndTime} onChange={(e) => setManualEndTime(e.target.value)} />
            </div>
            {manualStartDate && manualStartTime && manualEndDate && manualEndTime && (() => {
              const hrs = Math.round((new Date(`${manualEndDate}T${manualEndTime}`) - new Date(`${manualStartDate}T${manualStartTime}`)) / 3600000 * 10) / 10;
              return hrs > 0 ? (
                <div style={{ background: "#FFF5F9", borderRadius: 12, padding: 10, textAlign: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#6B6B6B" }}>Total: </span>
                  <span style={{ fontWeight: 800, color: "#FF0080", fontSize: 16 }}>{hrs}h</span>
                  <span style={{ fontSize: 12, color: "#6B6B6B" }}> = {formatCurrency(hrs * settings.hourlyRate)}</span>
                </div>
              ) : null;
            })()}
            <div style={{ display: "flex", gap: 8 }}>
              <GradientButton variant="secondary" onClick={() => setShowManualTime(false)} style={{ flex: 1 }}>Cancel</GradientButton>
              <GradientButton onClick={saveManualTime} style={{ flex: 1 }}>💾 Save Time</GradientButton>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Contact Modal */}
      {showEditContact && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <Card style={{ width: "100%", maxWidth: 400 }}>
            <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 18, fontWeight: 800, margin: "0 0 14px" }}>✏️ Edit Client Details</h3>
            <Input label="Client Name *" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Client name" />
            <Input label="Phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="425-555-1234" type="tel" />
            <Input label="Email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email@example.com" type="email" />
            <Input label="Address" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="123 Main St" />
            <div style={{ display: "flex", gap: 8 }}>
              <GradientButton variant="secondary" onClick={() => setShowEditContact(false)} style={{ flex: 1 }}>Cancel</GradientButton>
              <GradientButton onClick={saveContact} style={{ flex: 1 }}>💾 Save</GradientButton>
            </div>
          </Card>
        </div>
      )}

      {/* Invoice Preview Modal — editable amount before submitting */}
      {showInvoicePreview && (() => {
        // Bill on ESTIMATED hours (actual is for Thea's tracking only)
        const billableHours = job.estimatedHours || 0;
        const estBase = billableHours * settings.hourlyRate;
        const discount = job.discountType === "percent" ? estBase * ((job.discountValue || 0) / 100) : job.discountType === "dollar" ? (job.discountValue || 0) : 0;
        const afterDiscount = Math.max(0, estBase - discount);
        const tax = job.paymentMethod !== "cash" ? afterDiscount * WA_TAX_RATE : 0;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
            <Card style={{ width: "100%", maxWidth: 420, maxHeight: "85vh", overflow: "auto" }}>
              <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 18, fontWeight: 800, margin: "0 0 4px" }}>🧾 Invoice Preview</h3>
              <p style={{ fontSize: 12, color: "#6B6B6B", margin: "0 0 14px", lineHeight: 1.5 }}>Review the amount before sending. You can override it if needed.</p>

              {/* Per-space breakdown */}
              {spaces.length > 0 && (
                <div style={{ background: "#FFF5F9", borderRadius: 14, padding: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 6 }}>Per-space billing (based on estimated hours):</div>
                  {spaces.map(s => {
                    const sEmoji = SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦";
                    const estHrs = s.estimatedHours || 0;
                    return (
                      <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(255,60,172,0.08)" }}>
                        <span>{sEmoji} {s.spaceType}{s.scheduledDate ? ` (${formatDate(s.scheduledDate)})` : ""}</span>
                        <span style={{ fontWeight: 600 }}>
                          <span style={{ color: "#FF3CAC" }}>{estHrs}h</span>
                          {s.actualHours != null && <span style={{ color: "#6B6B6B", fontSize: 10 }}> ({s.actualHours}h actual)</span>}
                          {" = "}{formatCurrency(estHrs * settings.hourlyRate)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Totals */}
              <div style={{ background: "#FFF5F9", borderRadius: 14, padding: 14, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B6B6B", marginBottom: 4 }}>
                  <span>Billable hours</span>
                  <span style={{ fontWeight: 700, color: "#2D2D2D" }}>{billableHours}h × {formatCurrency(settings.hourlyRate)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B6B6B", marginBottom: 4 }}>
                  <span>Subtotal</span>
                  <span style={{ fontWeight: 600 }}>{formatCurrency(estBase)}</span>
                </div>
                {discount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#059669", marginBottom: 4 }}>
                    <span>Discount ({job.discountType === "percent" ? `${job.discountValue}%` : formatCurrency(job.discountValue)})</span>
                    <span style={{ fontWeight: 600 }}>-{formatCurrency(discount)}</span>
                  </div>
                )}
                {tax > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B6B6B", marginBottom: 4 }}>
                    <span>WA Sales Tax (10.25%)</span>
                    <span style={{ fontWeight: 600 }}>{formatCurrency(tax)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B6B6B", marginTop: 4, paddingTop: 6, borderTop: "1px solid #FFB3D1" }}>
                  <span>Auto-calculated total</span>
                  <span style={{ fontWeight: 700, color: "#FF0080" }}>{formatCurrency(afterDiscount + tax)}</span>
                </div>
                {totalActualHours > 0 && totalActualHours !== (job.estimatedHours || 0) && (
                  <div style={{ fontSize: 11, color: "#6B6B6B", marginTop: 8, background: "#fff", borderRadius: 8, padding: 8 }}>
                    💡 Billed on estimated <strong>{job.estimatedHours}h</strong>. Actual time worked was <strong>{totalActualHours}h</strong>. Adjust the amount below if needed.
                  </div>
                )}
              </div>

              {/* Editable amount */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#2D2D2D", marginBottom: 4, display: "block" }}>💰 Invoice Amount (editable)</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, fontWeight: 800, color: "#FF0080" }}>$</span>
                  <input type="number" step="0.01" min="0" value={invoiceEditAmount} onChange={(e) => setInvoiceEditAmount(parseFloat(e.target.value) || 0)} style={{ width: "100%", padding: "14px 14px 14px 30px", borderRadius: 14, border: "2px solid #FFB3D1", fontSize: 20, fontWeight: 800, color: "#FF0080", outline: "none", background: "#FFF5F9", fontFamily: "'Nunito', sans-serif", textAlign: "right" }} onFocus={(e) => e.target.style.borderColor = "#FF3CAC"} onBlur={(e) => e.target.style.borderColor = "#FFB3D1"} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <GradientButton variant="secondary" onClick={() => setShowInvoicePreview(false)} style={{ flex: 1 }}>Cancel</GradientButton>
                <GradientButton onClick={submitInvoice} style={{ flex: 1 }}>🧾 Submit Invoice</GradientButton>
              </div>
            </Card>
          </div>
        );
      })()}

      {/* Combined Invoice Modal */}
      {showCombinedInvoice && <CombinedInvoiceModal
        currentJob={job}
        sameClientJobs={sameClientJobs}
        settings={settings}
        onClose={() => setShowCombinedInvoice(false)}
        onGenerate={generateCombinedInvoice}
      />}
    </div>
  );
}

function CombinedInvoiceModal({ currentJob, sameClientJobs, settings, onClose, onGenerate }) {
  const [selected, setSelected] = useState(sameClientJobs.map(j => j.id));
  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const allJobs = [currentJob, ...sameClientJobs.filter(j => selected.includes(j.id))];
  let autoTotal = 0;
  const breakdown = allJobs.map(j => {
    let base = (j.estimatedHours || 0) * settings.hourlyRate;
    if (j.discountType === "percent") base -= base * ((j.discountValue || 0) / 100);
    else if (j.discountType === "dollar") base -= (j.discountValue || 0);
    const preTax = Math.max(0, base);
    const tax = j.paymentMethod !== "cash" ? preTax * WA_TAX_RATE : 0;
    const total = preTax + tax;
    autoTotal += total;
    return { job: j, hours: j.estimatedHours || 0, actualHours: j.actualHours, preTax, tax, total };
  });

  const [editTotal, setEditTotal] = useState(Math.round(autoTotal * 100) / 100);

  // Recalculate when selection changes
  useEffect(() => {
    let t = 0;
    [currentJob, ...sameClientJobs.filter(j => selected.includes(j.id))].forEach(j => {
      let base = (j.estimatedHours || 0) * settings.hourlyRate;
      if (j.discountType === "percent") base -= base * ((j.discountValue || 0) / 100);
      else if (j.discountType === "dollar") base -= (j.discountValue || 0);
      const preTax = Math.max(0, base);
      const tax = j.paymentMethod !== "cash" ? preTax * WA_TAX_RATE : 0;
      t += preTax + tax;
    });
    setEditTotal(Math.round(t * 100) / 100);
  }, [selected]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <Card style={{ width: "100%", maxWidth: 420, maxHeight: "85vh", overflow: "auto" }}>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 18, fontWeight: 800, margin: "0 0 4px" }}>📋 Combined Invoice</h3>
        <p style={{ fontSize: 12, color: "#6B6B6B", margin: "0 0 14px", lineHeight: 1.5 }}>Bill <strong>{currentJob.clientName}</strong> for multiple jobs in one invoice.</p>

        {/* Current job (always included) */}
        <div style={{ background: "#FFF5F9", borderRadius: 14, padding: 12, marginBottom: 8, border: "1.5px solid #FFB3D1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#2D2D2D" }}>✨ This Job (included)</div>
              <div style={{ fontSize: 11, color: "#6B6B6B" }}>{getJobSummary(currentJob.spaces)} • {currentJob.estimatedHours}h est.{currentJob.actualHours ? ` (${currentJob.actualHours}h actual)` : ""}</div>
              {currentJob.scheduledDate && <div style={{ fontSize: 10, color: "#FF3CAC", fontWeight: 600 }}>📅 {formatDate(currentJob.scheduledDate)}</div>}
            </div>
            <div style={{ fontWeight: 800, color: "#FF0080", fontSize: 14 }}>{formatCurrency(breakdown[0]?.total || 0)}</div>
          </div>
        </div>

        {/* Other same-client jobs */}
        {sameClientJobs.length > 0 && (
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6B6B", marginBottom: 6 }}>Select additional jobs to include:</div>
        )}
        {sameClientJobs.map(j => {
          const isSelected = selected.includes(j.id);
          const bk = breakdown.find(b => b.job.id === j.id);
          return (
            <div key={j.id} onClick={() => toggle(j.id)} style={{ background: isSelected ? "#FFF5F9" : "#fff", borderRadius: 14, padding: 12, marginBottom: 6, border: isSelected ? "1.5px solid #FFB3D1" : "1.5px solid #E5E7EB", cursor: "pointer", transition: "all 0.2s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, border: isSelected ? "2px solid #FF0080" : "2px solid #D1D5DB", background: isSelected ? "#FF0080" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", fontWeight: 700, transition: "all 0.2s", flexShrink: 0 }}>
                    {isSelected && "✓"}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#2D2D2D" }}>{getJobSummary(j.spaces)} • {j.estimatedHours}h est.{j.actualHours ? ` (${j.actualHours}h actual)` : ""}</div>
                    <div style={{ fontSize: 10, color: "#6B6B6B" }}>
                      {j.scheduledDate ? formatDate(j.scheduledDate) : "No date"} • {j.status}
                    </div>
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: isSelected ? "#FF0080" : "#999", fontSize: 13 }}>{bk ? formatCurrency(bk.total) : "—"}</div>
              </div>
            </div>
          );
        })}

        {/* Total breakdown */}
        <div style={{ background: "linear-gradient(135deg, #FFF5F9, #FFE0F0)", borderRadius: 14, padding: 14, marginTop: 8 }}>
          {breakdown.map((b, i) => (
            <div key={b.job.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6B6B6B", padding: "3px 0", borderBottom: i < breakdown.length - 1 ? "1px solid rgba(255,60,172,0.1)" : "none" }}>
              <span>{i === 0 ? "This job" : getJobSummary(b.job.spaces)} ({b.hours}h{b.tax > 0 ? " + tax" : ""})</span>
              <span style={{ fontWeight: 600 }}>{formatCurrency(b.total)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "2px solid #FFB3D1", alignItems: "center" }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: "#2D2D2D" }}>Auto-calculated</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#6B6B6B" }}>{formatCurrency(autoTotal)}</span>
          </div>
        </div>

        {/* Editable total */}
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#2D2D2D", marginBottom: 4, display: "block" }}>💰 Final Invoice Amount (editable)</label>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, fontWeight: 800, color: "#FF0080" }}>$</span>
            <input type="number" step="0.01" min="0" value={editTotal} onChange={(e) => setEditTotal(parseFloat(e.target.value) || 0)} style={{ width: "100%", padding: "14px 14px 14px 30px", borderRadius: 14, border: "2px solid #FFB3D1", fontSize: 20, fontWeight: 800, color: "#FF0080", outline: "none", background: "#FFF5F9", fontFamily: "'Nunito', sans-serif", textAlign: "right" }} onFocus={(e) => e.target.style.borderColor = "#FF3CAC"} onBlur={(e) => e.target.style.borderColor = "#FFB3D1"} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <GradientButton variant="secondary" onClick={onClose} style={{ flex: 1 }}>Cancel</GradientButton>
          <GradientButton onClick={() => onGenerate(selected, editTotal)} style={{ flex: 1 }}>🧾 Generate Combined Invoice</GradientButton>
        </div>
      </Card>
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
    <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 28, fontWeight: 800, color: "#FF3CAC", marginTop: 4, letterSpacing: 2 }}>
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </div>
  );
}

// ─── Tutoring Page ───
function TutoringPage({ sessions, settings, addSession, updateSession, deleteSession, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [sessionDuration, setSessionDuration] = useState(null); // minutes
  const [sessionStudent, setSessionStudent] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const tiers = settings.tutoringTiers || DEFAULT_TUTORING_TIERS;
  const totalEarned = sessions.reduce((s, t) => s + getTutoringEarning(t, settings), 0);
  const totalSessions = sessions.length;
  const uniqueStudents = [...new Set(sessions.map(t => t.student?.toLowerCase().trim()).filter(Boolean))];
  const thisMonth = sessions.filter(t => {
    if (!t.date) return false;
    const [y, m] = t.date.split("-").map(Number);
    const now = new Date();
    return m === now.getMonth() + 1 && y === now.getFullYear();
  });
  const thisMonthEarned = thisMonth.reduce((s, t) => s + getTutoringEarning(t, settings), 0);

  const getEarningForDuration = (mins) => {
    const tier = tiers.find(t => t.minutes === mins);
    return tier ? tier.price : 0;
  };

  const saveSession = () => {
    if (!sessionDate || !sessionDuration) return showToast("Pick a date and duration", "error");
    const earning = getEarningForDuration(sessionDuration);
    if (editingId) {
      updateSession(editingId, { date: sessionDate, duration: sessionDuration, hours: sessionDuration / 60, earning, student: sessionStudent.trim(), notes: sessionNotes.trim() });
      setEditingId(null);
      showToast("Session updated! 📚");
    } else {
      addSession({ id: generateId(), date: sessionDate, duration: sessionDuration, hours: sessionDuration / 60, earning, student: sessionStudent.trim(), notes: sessionNotes.trim(), createdAt: new Date().toISOString() });
    }
    setShowAdd(false);
    setSessionDate(new Date().toISOString().split("T")[0]);
    setSessionDuration(null);
    setSessionStudent("");
    setSessionNotes("");
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setSessionDate(s.date);
    setSessionDuration(s.duration || (s.hours ? Math.round(s.hours * 60) : null));
    setSessionStudent(s.student || "");
    setSessionNotes(s.notes || "");
    setShowAdd(true);
  };

  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 22, fontWeight: 900, margin: 0, color: "#2D2D2D" }}>📚 Tutoring</h2>
        <button onClick={() => { setEditingId(null); setSessionDate(new Date().toISOString().split("T")[0]); setSessionDuration(null); setSessionStudent(""); setSessionNotes(""); setShowAdd(true); }} style={{ background: "linear-gradient(135deg, #6A1B9A, #9C27B0)", border: "none", borderRadius: 20, padding: "9px 18px", color: "#fff", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "'Nunito', sans-serif", boxShadow: "0 4px 12px rgba(106,27,154,0.3)" }}>
          + Log Session
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Card style={{ padding: 14, textAlign: "center", background: "linear-gradient(135deg, #F3E8FF, #E8C5F5)", border: "none" }}>
          <div style={{ fontSize: 10, color: "#6B6B6B", fontWeight: 600 }}>This Month</div>
          <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 20, fontWeight: 900, color: "#6A1B9A" }}>{formatCurrency(thisMonthEarned)}</div>
          <div style={{ fontSize: 10, color: "#6B6B6B" }}>{thisMonth.length} session{thisMonth.length !== 1 ? "s" : ""}</div>
        </Card>
        <Card style={{ padding: 14, textAlign: "center", background: "linear-gradient(135deg, #FFF5F9, #FFE0F0)", border: "none" }}>
          <div style={{ fontSize: 10, color: "#6B6B6B", fontWeight: 600 }}>All Time</div>
          <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 20, fontWeight: 900, color: "#FF3CAC" }}>{formatCurrency(totalEarned)}</div>
          <div style={{ fontSize: 10, color: "#6B6B6B" }}>{totalSessions} session{totalSessions !== 1 ? "s" : ""} • {uniqueStudents.length} student{uniqueStudents.length !== 1 ? "s" : ""}</div>
        </Card>
      </div>

      {/* Rate tiers display */}
      <Card style={{ padding: 12, background: "linear-gradient(135deg, #F3E8FF, #FFF5F9)", border: "none" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6A1B9A", marginBottom: 6 }}>💰 Rate Card</div>
        <div style={{ display: "flex", gap: 8 }}>
          {tiers.map(t => (
            <div key={t.minutes} style={{ flex: 1, background: "rgba(255,255,255,0.7)", borderRadius: 12, padding: "8px 6px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 900, color: "#6A1B9A", fontSize: 18 }}>{formatCurrency(t.price)}</div>
              <div style={{ fontSize: 10, color: "#6B6B6B", fontWeight: 600 }}>{t.label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Add/Edit form */}
      {showAdd && (
        <Card style={{ border: "2px solid #CE93D8" }}>
          <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "#6A1B9A" }}>{editingId ? "✏️ Edit Session" : "📚 Log Tutoring Session"}</h3>
          <Input label="Date *" type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B", marginBottom: 6, display: "block" }}>Duration *</label>
            <div style={{ display: "flex", gap: 8 }}>
              {tiers.map(t => (
                <button key={t.minutes} onClick={() => setSessionDuration(t.minutes)} style={{ flex: 1, padding: "14px 8px", borderRadius: 14, border: sessionDuration === t.minutes ? "2.5px solid #6A1B9A" : "2px solid #E5E7EB", background: sessionDuration === t.minutes ? "linear-gradient(135deg, #F3E8FF, #E8C5F5)" : "#fff", cursor: "pointer", textAlign: "center", transition: "all 0.2s" }}>
                  <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 900, color: sessionDuration === t.minutes ? "#6A1B9A" : "#999", fontSize: 18 }}>{formatCurrency(t.price)}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sessionDuration === t.minutes ? "#6A1B9A" : "#6B6B6B" }}>{t.label}</div>
                </button>
              ))}
            </div>
          </div>
          <Input label="Student Name (optional)" placeholder="e.g. Maya" value={sessionStudent} onChange={(e) => setSessionStudent(e.target.value)} />
          <TextArea label="Notes (optional)" placeholder="What was covered?" value={sessionNotes} onChange={(e) => setSessionNotes(e.target.value)} />
          {sessionDuration && (
            <div style={{ background: "#F3E8FF", borderRadius: 12, padding: 10, marginBottom: 10, textAlign: "center" }}>
              <span style={{ fontSize: 12, color: "#6B6B6B" }}>Earning: </span>
              <span style={{ fontWeight: 800, color: "#6A1B9A", fontSize: 18 }}>{formatCurrency(getEarningForDuration(sessionDuration))}</span>
              <span style={{ fontSize: 11, color: "#6B6B6B" }}> for {tiers.find(t => t.minutes === sessionDuration)?.label || `${sessionDuration}min`}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <GradientButton variant="secondary" onClick={() => { setShowAdd(false); setEditingId(null); }} style={{ flex: 1 }}>Cancel</GradientButton>
            <button onClick={saveSession} style={{ flex: 1, background: "linear-gradient(135deg, #6A1B9A, #9C27B0)", border: "none", borderRadius: 20, padding: "12px", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Nunito', sans-serif", boxShadow: "0 4px 12px rgba(106,27,154,0.25)" }}>
              {editingId ? "💾 Update" : "📚 Log Session"}
            </button>
          </div>
        </Card>
      )}

      {/* Session list */}
      <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 800, margin: "4px 0 0", color: "#2D2D2D" }}>📋 Sessions</h3>
      {sorted.length === 0 && (
        <Card style={{ textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📚</div>
          <p style={{ fontSize: 13, color: "#6B6B6B", margin: 0 }}>No tutoring sessions yet. Tap "Log Session" to start tracking!</p>
        </Card>
      )}
      {sorted.map(s => {
        const earned = getTutoringEarning(s, settings);
        const tierMatch = tiers.find(t => t.minutes === s.duration);
        return (
          <Card key={s.id} style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#2D2D2D" }}>{formatDate(s.date)}</span>
                  {s.student && <span style={{ fontSize: 10, background: "#F3E8FF", color: "#6A1B9A", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>{s.student}</span>}
                  <span style={{ fontSize: 10, background: "#E8C5F5", color: "#6A1B9A", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>{tierMatch ? tierMatch.label : `${s.duration || Math.round((s.hours || 0) * 60)}min`}</span>
                </div>
                {s.notes && <div style={{ fontSize: 11, color: "#999", marginTop: 3, fontStyle: "italic" }}>{s.notes}</div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 900, color: "#6A1B9A", fontSize: 16 }}>{formatCurrency(earned)}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => startEdit(s)} style={{ background: "none", border: "1px solid #CE93D8", borderRadius: 8, padding: "3px 8px", fontSize: 10, color: "#6A1B9A", fontWeight: 700, cursor: "pointer" }}>✏️</button>
                  {confirmDeleteId === s.id ? (
                    <>
                      <button onClick={() => { deleteSession(s.id); setConfirmDeleteId(null); }} style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 8, padding: "3px 8px", fontSize: 10, color: "#DC2626", fontWeight: 700, cursor: "pointer" }}>Yes</button>
                      <button onClick={() => setConfirmDeleteId(null)} style={{ background: "#F3F4F6", border: "1px solid #E5E7EB", borderRadius: 8, padding: "3px 8px", fontSize: 10, color: "#6B6B6B", fontWeight: 700, cursor: "pointer" }}>No</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(s.id)} style={{ background: "none", border: "1px solid #FECACA", borderRadius: 8, padding: "3px 8px", fontSize: 10, color: "#DC2626", fontWeight: 700, cursor: "pointer" }}>🗑️</button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
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

  // Build calendar entries from: job-level scheduleDays, job-level scheduledDate, AND per-space scheduledDate
  const getJobsForDay = (day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const results = [];
    data.jobs.forEach(j => {
      // Job-level schedule days
      const days = (j.scheduleDays || []).filter(d => d.date);
      if (days.length > 0) {
        const matchDay = days.find(d => d.date === dateStr);
        if (matchDay) results.push({ ...j, _dayInfo: matchDay, _label: `${j.clientName.split(" ")[0]}` });
      } else if (j.scheduledDate === dateStr) {
        results.push({ ...j, _label: `${j.clientName.split(" ")[0]}` });
      }
      // Per-space scheduled dates (only if not already matched above)
      (j.spaces || []).forEach(s => {
        if (s.scheduledDate === dateStr && !results.find(r => r.id === j.id && r._spaceId === s.id)) {
          const emoji = SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦";
          results.push({ ...j, _spaceId: s.id, _spaceInfo: s, _label: `${j.clientName.split(" ")[0]} ${emoji}` });
        }
      });
    });
    // Deduplicate by job.id + spaceId
    const seen = new Set();
    return results.filter(r => {
      const key = `${r.id}-${r._spaceId || "job"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const isToday = (day) => { const t = new Date(); return day === t.getDate() && month === t.getMonth() && year === t.getFullYear(); };
  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calDays.push(d);

  // Build "This Month's Jobs" flat list including per-space entries
  const monthEntries = [];
  data.jobs.forEach(job => {
    // Job-level schedule days
    const days = (job.scheduleDays || []).filter(d => d.date);
    if (days.length > 0) {
      days.forEach((d, i) => {
        const dt = new Date(d.date);
        if (dt.getMonth() === month && dt.getFullYear() === year) {
          monthEntries.push({ job, date: d.date, label: `${getJobSummary(job.spaces)}`, subLabel: `Day ${i + 1}/${days.length} • ${d.startTime || ""} • ${d.hours}h`, type: "schedule" });
        }
      });
    } else if (job.scheduledDate) {
      const dt = new Date(job.scheduledDate);
      if (dt.getMonth() === month && dt.getFullYear() === year) {
        monthEntries.push({ job, date: job.scheduledDate, label: `${getJobSummary(job.spaces)}`, subLabel: `${job.scheduledTime || ""} • ${job.estimatedHours || 0}h`, type: "schedule" });
      }
    }
    // Per-space scheduled dates
    (job.spaces || []).forEach(s => {
      if (s.scheduledDate) {
        const dt = new Date(s.scheduledDate);
        if (dt.getMonth() === month && dt.getFullYear() === year) {
          const emoji = SPACE_TYPES.find(t => t.label === s.spaceType)?.emoji || "📦";
          monthEntries.push({ job, date: s.scheduledDate, label: `${emoji} ${s.spaceType}`, subLabel: `${s.scheduledTime || ""} • ${s.estimatedHours || 0}h est.${s.actualHours != null ? ` • ${s.actualHours}h actual` : ""}`, type: "space" });
        }
      }
    });
  });
  monthEntries.sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={() => setCurrentMonth(new Date(year, month - 1))} style={{ background: "linear-gradient(135deg, #FFB3D1, #E8C5F5)", border: "none", borderRadius: 16, padding: "8px 16px", cursor: "pointer", fontWeight: 800, color: "#FF0080", fontSize: 16, fontFamily: "'Nunito', sans-serif" }}>‹</button>
        <h2 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 18, fontWeight: 900, margin: 0, color: "#2D2D2D" }}>📅 {monthName}</h2>
        <button onClick={() => setCurrentMonth(new Date(year, month + 1))} style={{ background: "linear-gradient(135deg, #FFB3D1, #E8C5F5)", border: "none", borderRadius: 16, padding: "8px 16px", cursor: "pointer", fontWeight: 800, color: "#FF0080", fontSize: 16, fontFamily: "'Nunito', sans-serif" }}>›</button>
      </div>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
            <div key={d} style={{ fontSize: 10, fontWeight: 700, color: "#6B6B6B", padding: "6px 0" }}>{d}</div>
          ))}
          {calDays.map((day, i) => {
            if (!day) return <div key={`e-${i}`} />;
            const jobs = getJobsForDay(day);
            const today = isToday(day);
            return (
              <div key={day} style={{ padding: "6px 2px", borderRadius: 10, minHeight: 44, background: today ? "linear-gradient(135deg, #FF3CAC, #FF0080)" : jobs.length ? "#FFE0F0" : "transparent", cursor: jobs.length ? "pointer" : "default" }} onClick={() => { if (jobs.length) openJob(jobs[0].id); }}>
                <div style={{ fontSize: 12, fontWeight: today ? 800 : 500, color: today ? "#fff" : "#333" }}>{day}</div>
                {jobs.slice(0, 2).map((j, idx) => (
                  <div key={idx} style={{ fontSize: 7, background: today ? "rgba(255,255,255,0.3)" : j._spaceInfo ? "#6A1B9A" : "#FF0080", color: "#fff", borderRadius: 4, padding: "1px 3px", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                    {j._label}
                  </div>
                ))}
                {jobs.length > 2 && <div style={{ fontSize: 7, color: today ? "#fff" : "#FF3CAC", fontWeight: 700 }}>+{jobs.length - 2}</div>}
              </div>
            );
          })}
        </div>
      </Card>
      <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, color: "#2D2D2D", margin: "16px 0 10px" }}>📋 This Month's Jobs</h3>
      {monthEntries.length === 0 && (
        <Card style={{ textAlign: "center", padding: 20 }}>
          <p style={{ color: "#6B6B6B", fontSize: 13 }}>No jobs scheduled this month</p>
        </Card>
      )}
      {monthEntries.map((entry, idx) => (
        <Card key={`${entry.job.id}-${idx}`} onClick={() => openJob(entry.job.id)} style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {entry.job.clientName}
                {entry.type === "space" && <span style={{ fontSize: 11, color: "#6A1B9A", fontWeight: 600, marginLeft: 6 }}>{entry.label}</span>}
              </div>
              <div style={{ fontSize: 11, color: "#6B6B6B" }}>
                {entry.type === "schedule" && <>{getJobEmojis(entry.job.spaces)} {entry.label} • </>}
                {formatDate(entry.date)} {entry.subLabel && `• ${entry.subLabel}`}
              </div>
            </div>
            <StatusBadge status={entry.job.status} />
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Analytics ───
function Analytics({ data }) {
  const paid = data.jobs.filter(j => j.status === "paid");
  const completed = data.jobs.filter(j => ["completed", "paid"].includes(j.status));
  // Revenue based on ESTIMATED hours (billing basis) — always recalculate, don't use stale finalAmount
  const cleaningRevenue = paid.reduce((s, j) => {
    return s + (j.estimatedHours || 0) * (data.settings?.hourlyRate || DEFAULT_RATE);
  }, 0);
  const tutoringRate = data.settings?.tutoringRate || DEFAULT_TUTORING_RATE;
  const tutoringRevenue = (data.tutoringSessions || []).reduce((s, t) => s + getTutoringEarning(t, data.settings), 0);
  const totalRevenue = cleaningRevenue + tutoringRevenue;
  const totalEstimatedHours = completed.reduce((s, j) => s + (j.estimatedHours || 0), 0);
  const totalActualHoursAll = completed.reduce((s, j) => s + (getEffectiveActualHours(j) || 0), 0);
  const avgRating = completed.filter(j => j.feedback?.rating).reduce((s, j, _, arr) => s + j.feedback.rating / arr.length, 0);
  const estimateAccuracy = completed.filter(j => (getEffectiveActualHours(j) || j.actualHours) && j.estimatedHours);
  const avgDiff = estimateAccuracy.length ? estimateAccuracy.reduce((s, j) => s + Math.abs((getEffectiveActualHours(j) || j.actualHours) - j.estimatedHours), 0) / estimateAccuracy.length : 0;

  // Unique clients
  const uniqueClients = [...new Set(data.jobs.map(j => j.clientName?.toLowerCase().trim()).filter(Boolean))];

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
      <div style={{ position: "relative" }}>
        <h2 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 22, fontWeight: 900, margin: 0, color: "#2D2D2D" }}>📊 Your Stats</h2>
        <div style={{ position: "absolute", top: -4, right: 0, fontSize: 12, opacity: 0.25, animation: "sparkle 2.5s ease-in-out infinite" }}>✨</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Total Revenue", value: formatCurrency(totalRevenue), emoji: "💰", color: "#FF3CAC" },
          { label: "Clients", value: uniqueClients.length, emoji: "👥", color: "#6A1B9A" },
          { label: "Jobs Done", value: completed.length, emoji: "✅", color: "#10B981" },
          { label: "Spaces Done", value: totalSpaces, emoji: "🏠", color: "#FF3CAC" },
          { label: "Avg Rating", value: avgRating ? `${avgRating.toFixed(1)} ⭐` : "—", emoji: "🌟", color: "#F59E0B" },
          { label: "Avg Accuracy", value: avgDiff ? `±${avgDiff.toFixed(1)}h` : "—", emoji: "🎯", color: "#FF0080" },
        ].map((s, i) => (
          <Card key={s.label} style={{ padding: 16, textAlign: "center", animationDelay: `${i * 0.06}s` }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{s.emoji}</div>
            <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 20, fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#6B6B6B", fontWeight: 600 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Revenue split */}
      <Card style={{ background: "linear-gradient(135deg, #FFF5F9, #E8C5F5)", border: "none" }}>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💰 Revenue Breakdown</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: 14, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 16, marginBottom: 2 }}>🧹</div>
            <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 900, color: "#FF3CAC", fontSize: 18 }}>{formatCurrency(cleaningRevenue)}</div>
            <div style={{ fontSize: 10, color: "#6B6B6B" }}>Cleaning</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: 14, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 16, marginBottom: 2 }}>📚</div>
            <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 900, color: "#6A1B9A", fontSize: 18 }}>{formatCurrency(tutoringRevenue)}</div>
            <div style={{ fontSize: 10, color: "#6B6B6B" }}>Tutoring ({(data.tutoringSessions || []).length} sessions)</div>
          </div>
        </div>
      </Card>

      {/* Hours breakdown — estimated vs actual */}
      <Card style={{ background: "linear-gradient(135deg, #FFF5F9, #FFE0F0)", border: "none" }}>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>⏱️ Hours Breakdown</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: 14, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#6B6B6B", fontWeight: 600 }}>Estimated</div>
            <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 900, color: "#FF3CAC", fontSize: 20 }}>{Math.round(totalEstimatedHours * 10) / 10}h</div>
            <div style={{ fontSize: 10, color: "#6B6B6B" }}>(billable hours)</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: 14, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#6B6B6B", fontWeight: 600 }}>Actual</div>
            <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 900, color: "#059669", fontSize: 20 }}>{totalActualHoursAll > 0 ? `${Math.round(totalActualHoursAll * 10) / 10}h` : "—"}</div>
            <div style={{ fontSize: 10, color: "#6B6B6B" }}>(time worked)</div>
          </div>
        </div>
        {totalEstimatedHours > 0 && totalActualHoursAll > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, textAlign: "center", fontWeight: 600, color: totalActualHoursAll < totalEstimatedHours ? "#059669" : "#E11D48" }}>
            {totalActualHoursAll < totalEstimatedHours ? `✅ You saved ${(totalEstimatedHours - totalActualHoursAll).toFixed(1)}h vs estimates!` : totalActualHoursAll > totalEstimatedHours ? `⚠️ Went ${(totalActualHoursAll - totalEstimatedHours).toFixed(1)}h over estimates` : "✅ Right on target!"}
          </div>
        )}
      </Card>

      {/* Accuracy */}
      {estimateAccuracy.length > 0 && (
        <Card>
          <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>🎯 Estimate Accuracy</h3>
          {estimateAccuracy.map(j => {
            const effActual = getEffectiveActualHours(j) || j.actualHours;
            return (
            <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #F3F4F6", fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{j.clientName}</span>
              <span>Est: {j.estimatedHours}h → Actual: {effActual}h</span>
              <span style={{ fontWeight: 700, color: effActual > j.estimatedHours ? "#DC2626" : "#059669" }}>
                {effActual > j.estimatedHours ? "+" : ""}{(effActual - j.estimatedHours).toFixed(1)}h
              </span>
            </div>
            );
          })}
        </Card>
      )}

      {/* Revenue by space type */}
      {Object.keys(revenueByType).length > 0 && (
        <Card>
          <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💎 Revenue by Space Type</h3>
          {Object.entries(revenueByType).sort((a, b) => b[1] - a[1]).map(([type, amount]) => {
            const pct = totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0;
            const emoji = SPACE_TYPES.find(t => t.label === type)?.emoji || "📦";
            return (
              <div key={type} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{emoji} {type}</span>
                  <span style={{ fontWeight: 700, color: "#FF0080" }}>{formatCurrency(amount)}</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "#FFE0F0", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 4, background: "linear-gradient(90deg, #FF3CAC, #FF0080)", width: `${Math.min(pct, 100)}%`, transition: "width 0.5s" }} />
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* Rate Analysis */}
      <Card style={{ background: "linear-gradient(135deg, #FFD6C0, #FFE8F0, #E8C5F5)", border: "none", position: "relative", overflow: "hidden" }}>
        {/* Decorative mini bar chart SVG */}
        <svg style={{ position: "absolute", top: 12, right: 16, opacity: 0.12 }} width="60" height="50" viewBox="0 0 60 50" fill="none">
          <rect x="2" y="30" width="10" height="20" rx="3" fill="#FF3CAC"/>
          <rect x="16" y="18" width="10" height="32" rx="3" fill="#FF0080"/>
          <rect x="30" y="10" width="10" height="40" rx="3" fill="#FF3CAC"/>
          <rect x="44" y="22" width="10" height="28" rx="3" fill="#E040FB"/>
          <path d="M7 28l14-10 14-6 14 10" stroke="#FF0080" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5"/>
        </svg>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 15, fontWeight: 800, margin: "0 0 10px", color: "#2D2D2D" }}>💡 Rate Analysis</h3>
        <div style={{ fontSize: 13, color: "#2D2D2D", lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 8px" }}>Current rate: <strong style={{ color: "#FF0080", fontSize: 17 }}>{formatCurrency(data.settings.hourlyRate)}/hr</strong></p>
          {totalEstimatedHours > 0 && <p style={{ margin: "0 0 8px" }}>Effective rate: <strong style={{ color: totalRevenue / totalEstimatedHours >= data.settings.hourlyRate ? "#059669" : "#DC2626" }}>{formatCurrency(totalRevenue / totalEstimatedHours)}/hr</strong></p>}
          {avgDiff > 1 && <p style={{ margin: 0, background: "rgba(255,255,255,0.6)", padding: "8px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600 }}>💡 Your estimates are off by {avgDiff.toFixed(1)}h on average. Consider adjusting base times!</p>}
        </div>
      </Card>

      {/* Feedback */}
      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💬 Client Feedback</h3>
        {completed.filter(j => j.feedback).length > 0 ? (
          completed.filter(j => j.feedback).map(j => (
            <div key={j.id} style={{ padding: "8px 0", borderBottom: "1px solid #F3F4F6" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{j.clientName}</span>
                <span style={{ fontSize: 12 }}>{"⭐".repeat(j.feedback.rating)}</span>
              </div>
              {j.feedback.text && <p style={{ fontSize: 12, color: "#6B6B6B", margin: 0, fontStyle: "italic" }}>"{j.feedback.text}"</p>}
            </div>
          ))
        ) : (
          <p style={{ textAlign: "center", color: "#6B6B6B", fontSize: 13 }}>No feedback yet! Complete jobs to collect reviews ✨</p>
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
      <h2 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 22, fontWeight: 900, margin: 0, color: "#2D2D2D" }}>⚙️ Settings</h2>

      {/* Database Setup */}
      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 15, fontWeight: 800, margin: "0 0 10px", color: "#2D2D2D" }}>☁️ Database (Supabase)</h3>

        {dbConnected ? (
          <div style={{ background: "linear-gradient(135deg, #B8F0E0, #D1FAE5)", borderRadius: 14, padding: 12, marginBottom: 12, fontSize: 12, color: "#059669", fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>✅ Connected — data syncs automatically!</span>
            <button onClick={forceSync} disabled={syncing} style={{ background: "#059669", border: "none", borderRadius: 14, padding: "4px 12px", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", opacity: syncing ? 0.5 : 1, fontFamily: "'Nunito', sans-serif" }}>
              {syncing ? "⏳..." : "🔄 Sync"}
            </button>
          </div>
        ) : (
          <div style={{ background: "#FFD6C0", borderRadius: 14, padding: 12, marginBottom: 12, fontSize: 12, color: "#E65100", fontWeight: 600 }}>
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

        <button onClick={() => setShowDbGuide(!showDbGuide)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#FF0080", padding: 0 }}>
          {showDbGuide ? "▲ Hide setup guide" : "📖 How to set up Supabase (free, 5 min)"}
        </button>

        {showDbGuide && (
          <div style={{ background: "#FFF5F9", border: "1.5px solid #FFB3D1", borderRadius: 12, padding: 14, marginTop: 8, fontSize: 12, color: "#555", lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, color: "#FF0080", marginBottom: 6, fontSize: 13 }}>🚀 Free Supabase Setup (500MB database)</div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 1:</strong> Go to <span style={{ color: "#FF0080", fontWeight: 600 }}>supabase.com</span> → Sign up free → "New Project"
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
            <div style={{ background: "#B8F0E0", borderRadius: 8, padding: 8, fontWeight: 600, color: "#059669" }}>
              ✅ Paste both above and click "Connect & Test"!
            </div>
          </div>
        )}
      </Card>

      {/* Google Drive Photos */}
      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📁 Google Drive (Photo Storage)</h3>
        <div style={{ fontSize: 12, color: "#6B6B6B", marginBottom: 12, lineHeight: 1.5 }}>
          Upload before/after photos to a Google Drive folder. The app stores the photo filename in the database so you can find it later.
        </div>
        <Input label="Google Drive Folder URL" placeholder="https://drive.google.com/drive/folders/..." value={gdriveFolderUrl} onChange={(e) => setGdriveFolderUrl(e.target.value)} />
        <Input label="Folder ID (auto-extracted)" placeholder="Auto-fills from URL above" value={gdriveFolderId} onChange={(e) => setGdriveFolderId(e.target.value)} />
        <GradientButton onClick={saveGDriveSettings}>💾 Save Drive Settings</GradientButton>
        <div style={{ fontSize: 11, color: "#6B6B6B", marginTop: 8, lineHeight: 1.5 }}>
          📌 Create a folder in Google Drive called "SparkleSpace Photos" → Right-click → "Share" → Copy link → Paste above. Photos you take in the app will be named with the job/client info for easy lookup.
        </div>
      </Card>
      
      {/* Email Setup */}
      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>📧 Email Service (EmailJS)</h3>
        
        {(settings.emailjsPublicKey || DEFAULT_EMAILJS.publicKey) ? (
          <div style={{ background: "#B8F0E0", borderRadius: 14, padding: 12, marginBottom: 12, fontSize: 12, color: "#059669", fontWeight: 600 }}>
            ✅ Email is configured and ready to send!
          </div>
        ) : (
          <div style={{ background: "#FFD6C0", borderRadius: 14, padding: 12, marginBottom: 12, fontSize: 12, color: "#E65100", fontWeight: 600 }}>
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

        <button onClick={() => setShowEmailGuide(!showEmailGuide)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#FF0080", padding: 0 }}>
          {showEmailGuide ? "▲ Hide setup guide" : "📖 How to set up EmailJS (free, 5 min)"}
        </button>

        {showEmailGuide && (
          <div style={{ background: "#FFF5F9", border: "1.5px solid #FFB3D1", borderRadius: 12, padding: 14, marginTop: 8, fontSize: 12, color: "#555", lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, color: "#FF0080", marginBottom: 6, fontSize: 13 }}>🚀 Free EmailJS Setup (200 emails/mo)</div>
            <div style={{ marginBottom: 8 }}>
              <strong>Step 1:</strong> Go to <span style={{ color: "#FF0080", fontWeight: 600 }}>emailjs.com</span> → Sign up free
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
            <div style={{ background: "#B8F0E0", borderRadius: 8, padding: 8, fontWeight: 600, color: "#059669" }}>
              ✅ Paste all 3 IDs above, save, and hit "Test Email"!
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💰 Pricing</h3>
        <Input label="Organizing Hourly Rate ($)" type="number" min="1" step="0.50" value={settings.hourlyRate} onChange={(e) => updateSettings({ hourlyRate: parseFloat(e.target.value) || DEFAULT_RATE })} />
        <div style={{ fontSize: 11, color: "#6B6B6B", marginTop: -8, marginBottom: 12 }}>WA sales tax (10.25%) auto-applies for non-cash payments</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#6A1B9A", marginBottom: 8 }}>📚 Tutoring Rate Tiers</div>
        {(settings.tutoringTiers || DEFAULT_TUTORING_TIERS).map((tier, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <Input label={`Tier ${i + 1}: Duration (min)`} type="number" min="15" step="15" value={tier.minutes} onChange={(e) => {
                const tiers = [...(settings.tutoringTiers || DEFAULT_TUTORING_TIERS)];
                tiers[i] = { ...tiers[i], minutes: parseInt(e.target.value) || 45, label: `${parseInt(e.target.value) || 45} min` };
                if (tiers[i].minutes >= 60) tiers[i].label = `${tiers[i].minutes / 60} hour${tiers[i].minutes > 60 ? "s" : ""}`;
                updateSettings({ tutoringTiers: tiers });
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <Input label={`Price ($)`} type="number" min="1" step="1" value={tier.price} onChange={(e) => {
                const tiers = [...(settings.tutoringTiers || DEFAULT_TUTORING_TIERS)];
                tiers[i] = { ...tiers[i], price: parseFloat(e.target.value) || 0 };
                updateSettings({ tutoringTiers: tiers });
              }} />
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: "#6B6B6B", marginTop: -4, marginBottom: 4 }}>Current: {(settings.tutoringTiers || DEFAULT_TUTORING_TIERS).map(t => `${t.label} = ${formatCurrency(t.price)}`).join(" • ")}</div>
      </Card>
      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>💳 Payment Integration</h3>
        <Input label="Stripe Publishable Key" placeholder="pk_live_..." value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} />
        <GradientButton onClick={() => { updateSettings({ stripeKey }); showToast("Stripe key saved! 💳"); }}>Save Stripe Key</GradientButton>
        <div style={{ fontSize: 11, color: "#6B6B6B", marginTop: 8, lineHeight: 1.5 }}>🔗 Create a free Stripe account at stripe.com to accept card payments. Venmo & Zelle tracked manually.</div>
      </Card>
      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>ℹ️ About SparkleSpace</h3>
        <div style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 8px" }}>✨ <strong>SparkleSpace by Thea</strong></p>
          <p style={{ margin: "0 0 8px" }}>Your organizing business management app! Track assessments, schedule jobs, manage clients, handle payments, and grow your business. 🌟</p>
          <p style={{ margin: 0, fontSize: 11, color: "#6B6B6B" }}>v1.8 • Manual Time + Edit Contact + Combined Invoice • Made with 💖</p>
        </div>
      </Card>
      <Card>
        <h3 style={{ fontFamily: "'Nunito', sans-serif", fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>🗑️ Data</h3>
        <GradientButton variant="danger" onClick={() => { if (confirm("Are you sure? This will delete ALL local data!")) { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(SUPABASE_CONFIG_KEY); localStorage.removeItem(GDRIVE_CONFIG_KEY); window.location.reload(); } }}>Reset All Local Data</GradientButton>
        <div style={{ fontSize: 11, color: "#6B6B6B", marginTop: 8 }}>⚠️ This clears local cache. Database data (if connected) is preserved.</div>
      </Card>
    </div>
  );
}
