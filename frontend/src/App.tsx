import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, ListTodo, Clock3, CircleCheck, Plus, Search, LogOut,
  CalendarDays, ShieldCheck, Users, RefreshCw, Trash2, UserRound, Gauge,
} from "lucide-react";
import Auth from "./Auth";
import "./App.css";

const API = "http://127.0.0.1:8000";

type User = { username: string; token: string; email?: string; role?: "admin" | "member"; id?: number };
type TeamUser = { id: number; username: string; email: string; role: string };
type Task = {
  id: number; title: string; description: string; status: string; priority: string;
  completed: boolean; progress: number; due_date: string | null; assigned_to: number | null;
  assignee_username: string | null; assignee_email: string | null;
};
const statuses = ["Todo", "In Progress", "Done"];
const priorities = ["Low", "Medium", "High", "Urgent"];

function App() {
  const [user, setUser] = useState<User | null>(() => {
    try { const saved = localStorage.getItem("taskforge_user"); return saved ? JSON.parse(saved) as User : null; }
    catch { return null; }
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");

  const isAdmin = user?.role === "admin";
  const headers = () => ({ Authorization: `Bearer ${user?.token}` });
  const jsonHeaders = () => ({ ...headers(), "Content-Type": "application/json" });

  function handleLogin(next: User) {
    // Refresh identity from /me so the role always comes from the backend.
    localStorage.setItem("taskforge_user", JSON.stringify(next));
    setUser(next);
    setError("");
  }
  function handleLogout() {
    localStorage.removeItem("taskforge_user");
    setUser(null); setTasks([]); setTeam([]); setError(""); setNotice("");
  }

  async function loadIdentity(token: string) {
    const response = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Your session expired. Please log in again.");
    const identity = await response.json();
    setUser((old) => {
      if (!old) return old;
      const updated = { ...old, ...identity };
      localStorage.setItem("taskforge_user", JSON.stringify(updated));
      return updated;
    });
  }

  async function loadTasks() {
    if (!user) return;
    setLoading(true);
    try {
      const response = await fetch(`${API}/tasks`, { headers: headers() });
      if (response.status === 401) { handleLogout(); throw new Error("Please log in again."); }
      if (!response.ok) throw new Error((await response.json()).detail || "Could not load tasks.");
      setTasks(await response.json()); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect to FastAPI."); }
    finally { setLoading(false); }
  }

  async function loadTeam() {
    if (!user || !isAdmin) return;
    const response = await fetch(`${API}/users`, { headers: headers() });
    if (!response.ok) throw new Error("Could not load team members.");
    setTeam(await response.json());
  }

  useEffect(() => {
    if (!user) return;
    loadIdentity(user.token).catch((e) => setError(e.message));
  // Identity refresh only when token changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token]);

  useEffect(() => {
    if (user) {
      loadTasks();
      if (user.role === "admin") loadTeam().catch((e) => setError(e.message));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token, user?.role]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/tasks`, {
        method: "POST", headers: jsonHeaders(),
        body: JSON.stringify({
          title, description, priority, due_date: dueDate || null,
          assigned_to: isAdmin && assignee ? Number(assignee) : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Could not create task.");
      setTitle(""); setDescription(""); setPriority("Medium"); setDueDate(""); setAssignee("");
      setShowForm(false); setNotice("Task created successfully."); await loadTasks();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create task."); }
  }

  async function updateProgress(task: Task, progress: number) {
    setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/tasks/${task.id}`, {
        method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ progress }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Could not update progress.");
      setTasks((old) => old.map((t) => t.id === task.id ? body : t));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update progress."); }
  }

  async function updateStatus(task: Task, status: string) {
    setError("");
    try {
      const response = await fetch(`${API}/tasks/${task.id}`, {
        method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Could not update status.");
      setTasks((old) => old.map((t) => t.id === task.id ? body : t));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update status."); }
  }

  async function adminUpdate(task: Task, updates: Record<string, unknown>) {
    setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/admin/tasks/${task.id}`, {
        method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(updates),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Could not update task.");
      setTasks((old) => old.map((t) => t.id === task.id ? body : t));
      setNotice("Task details updated.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update task."); }
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    try {
      const response = await fetch(`${API}/tasks/${task.id}`, { method: "DELETE", headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Could not delete task.");
      setTasks((old) => old.filter((t) => t.id !== task.id));
      setNotice("Task deleted.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete task."); }
  }

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const q = search.trim().toLowerCase();
    const matches = task.title.toLowerCase().includes(q) || task.description.toLowerCase().includes(q) ||
      (task.assignee_username || "").toLowerCase().includes(q);
    return matches && (filter === "All" || task.status === filter);
  }), [tasks, search, filter]);
  const completed = tasks.filter((t) => t.status === "Done" || t.completed).length;
  const inProgress = tasks.filter((t) => t.status === "In Progress").length;
  const overdue = tasks.filter((t) => t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== "Done").length;

  if (!user) return <Auth onLogin={handleLogin} />;

  return (
    <div className="tf-app">
      <aside className="tf-sidebar">
        <div className="tf-brand"><span className="tf-brand-icon"><Gauge size={22} /></span><span>TaskForge</span></div>
        <div className="tf-nav-label">WORKSPACE</div>
        <a className="tf-nav-item active" href="#dashboard"><LayoutDashboard size={18} /> Dashboard</a>
        <a
  className="tf-nav-item"
  href="#task-list"
  onClick={(event) => {
    event.preventDefault();
    document.getElementById("task-list")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }}
>
  <ListTodo size={18} />
  {isAdmin ? "All Tasks" : "My Tasks"}
</a>
        {isAdmin && <a className="tf-nav-item" href="#team"><Users size={18} /> Team Members</a>}
        <div className="tf-sidebar-spacer" />
        <div className="tf-profile">
          <div className="tf-avatar">{user.username.slice(0, 1).toUpperCase()}</div>
          <div className="tf-profile-text"><strong>{user.username}</strong><span>{isAdmin ? "Main Admin" : "Team Member"}</span></div>
          <button className="tf-icon-button" onClick={handleLogout} title="Log out"><LogOut size={17} /></button>
        </div>
      </aside>

      <main className="tf-main" id="dashboard">
        <header className="tf-topbar">
          <div><div className="tf-eyebrow">WORKSPACE / OVERVIEW</div><h1>{isAdmin ? "Team dashboard" : "My tasks"}</h1></div>
          <div className="tf-topbar-right">
            {isAdmin && <span className="tf-admin-badge"><ShieldCheck size={15} /> Admin</span>}
            <button className="tf-secondary-button" onClick={() => { loadTasks(); if (isAdmin) loadTeam(); }}><RefreshCw size={16} /> Refresh</button>
          </div>
        </header>

        <section className="tf-content">
          {error && <div className="tf-alert error">{error}</div>}
          {notice && <div className="tf-alert success">{notice}</div>}
          <div className="tf-stats">
            <div className="tf-stat-card"><span className="tf-stat-icon purple"><ListTodo size={20} /></span><div><span>Total tasks</span><strong>{tasks.length}</strong></div></div>
            <div className="tf-stat-card"><span className="tf-stat-icon blue"><Clock3 size={20} /></span><div><span>In progress</span><strong>{inProgress}</strong></div></div>
            <div className="tf-stat-card"><span className="tf-stat-icon green"><CircleCheck size={20} /></span><div><span>Completed</span><strong>{completed}</strong></div></div>
            <div className="tf-stat-card"><span className="tf-stat-icon orange"><CalendarDays size={20} /></span><div><span>Overdue</span><strong>{overdue}</strong></div></div>
          </div>

          <section className="tf-panel" id="task-list">
            <div className="tf-panel-heading">
              <div><h2>{isAdmin ? "All team tasks" : "Assigned to me"}</h2><p>{isAdmin ? "Assign work and monitor team progress." : "Update the progress percentage as you work."}</p></div>
              <button className="tf-primary-button" onClick={() => setShowForm(!showForm)}><Plus size={17} /> New task</button>
            </div>

            {showForm && <form className="tf-form" onSubmit={createTask}>
              <label>Task title<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Prepare project report" maxLength={200} /></label>
              <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add task details..." rows={3} /></label>
              <div className="tf-form-grid">
                <label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value)}>{priorities.map((p) => <option key={p}>{p}</option>)}</select></label>
                <label>Deadline<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
                {isAdmin && <label>Assign to<select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Unassigned</option>{team.map((member) => <option key={member.id} value={member.id}>{member.username} ({member.email})</option>)}</select></label>}
              </div>
              <div className="tf-form-actions"><button type="button" className="tf-secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button className="tf-primary-button" type="submit">Create task</button></div>
              {!isAdmin && <p className="tf-help">This task will be assigned to you. Only the admin can assign tasks to other users.</p>}
            </form>}

            <div className="tf-toolbar">
              <div className="tf-search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks or assignees..." /></div>
              <select className="tf-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option>All</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
            </div>

            {loading ? <div className="tf-empty">Loading tasks…</div> : visibleTasks.length === 0 ? <div className="tf-empty"><ListTodo size={30} /><strong>No tasks found</strong><span>{isAdmin ? "Create a task and assign it to a team member." : "Tasks assigned to you will appear here."}</span></div> :
              <div className="tf-task-list">{visibleTasks.map((task) => {
                const isOverdue = Boolean(task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== "Done");
                return <article className="tf-task-card" key={task.id}>
                  <div className="tf-task-top">
                    <div className="tf-task-title-wrap"><span className={`tf-status-dot ${task.status.toLowerCase().replace(" ", "-")}`} /><div><h3>{task.title}</h3><p>{task.description || "No description provided."}</p></div></div>
                    <span className={`tf-priority ${task.priority.toLowerCase()}`}>{task.priority}</span>
                  </div>
                  <div className="tf-task-meta">
                    <span><UserRound size={15} /> {task.assignee_username || "Unassigned"}</span>
                    <span className={isOverdue ? "is-overdue" : ""}><CalendarDays size={15} /> {task.due_date ? `${isOverdue ? "Overdue · " : ""}${task.due_date}` : "No deadline"}</span>
                    <span>{task.status}</span>
                  </div>
                  <div className="tf-progress-heading"><span>Progress</span><strong>{task.progress}%</strong></div>
                  <div className="tf-progress-track"><div className="tf-progress-fill" style={{ width: `${task.progress}%` }} /></div>
                  <div className="tf-task-controls">
                    <label className="tf-control-label">Progress <input aria-label={`Progress for ${task.title}`} type="range" min="0" max="100" step="5" value={task.progress} onChange={(e) => updateProgress(task, Number(e.target.value))} /><span>{task.progress}%</span></label>
                    <label className="tf-control-label">Status<select value={task.status} onChange={(e) => updateStatus(task, e.target.value)}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label>
                  </div>
                  {isAdmin && <div className="tf-admin-controls">
                    <label>Assignee<select value={task.assigned_to ?? ""} onChange={(e) => adminUpdate(task, { assigned_to: e.target.value ? Number(e.target.value) : null })}><option value="">Unassigned</option>{team.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}</select></label>
                    <label>Deadline<input type="date" value={task.due_date || ""} onChange={(e) => adminUpdate(task, { due_date: e.target.value || null })} /></label>
                    <label>Priority<select value={task.priority} onChange={(e) => adminUpdate(task, { priority: e.target.value })}>{priorities.map((p) => <option key={p}>{p}</option>)}</select></label>
                    <button className="tf-delete-button" onClick={() => deleteTask(task)} title="Delete task"><Trash2 size={15} /> Delete</button>
                  </div>}
                </article>;
              })}</div>
            }
          </section>

          {isAdmin && <section className="tf-panel" id="team">
            <div className="tf-panel-heading"><div><h2>Team members</h2><p>Accounts that can receive assigned tasks.</p></div><span className="tf-count">{team.length} accounts</span></div>
            <div className="tf-team-list">{team.map((member) => <div className="tf-team-row" key={member.id}><div className="tf-avatar">{member.username.slice(0, 1).toUpperCase()}</div><div className="tf-team-person"><strong>{member.username}</strong><span>{member.email}</span></div><span className={`tf-role ${member.role}`}>{member.role}</span><span className="tf-member-task-count">{tasks.filter((t) => t.assigned_to === member.id).length} tasks</span></div>)}</div>
          </section>}
          <footer className="tf-footer">TaskForge · Plan clearly. Work together. Deliver on time.</footer>
        </section>
      </main>
    </div>
  );
}

export default App;
