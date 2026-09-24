const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'college_support.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);
const CATEGORIES = ['Fees', 'Attendance', 'ID Card', 'Documents', 'Certificate', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES = ['New', 'Assigned', 'In Progress', 'Pending Student', 'Resolved', 'Closed'];
const ROLE_NAMES = ['Student', 'Staff', 'Admin'];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: 'college-support-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
      sameSite: 'lax'
    }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function computeSlaDate(createdAt, priority) {
  const date = new Date(createdAt);
  const daysMap = { Low: 5, Medium: 3, High: 2, Critical: 1 };
  const days = daysMap[priority] || 3;
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function isSlaBreached(ticket) {
  if (!ticket || !ticket.sla_due_at) return false;
  if (ticket.status === 'Resolved' || ticket.status === 'Closed') return false;
  return new Date(ticket.sla_due_at).getTime() < Date.now();
}

function normalizeTicket(ticket) {
  if (!ticket) return null;
  const created = new Date(ticket.created_at);
  const dueDate = new Date(ticket.sla_due_at);
  const ageMs = Date.now() - created.getTime();
  const ageHours = Math.max(0, Math.round(ageMs / (1000 * 60 * 60)));

  return {
    ...ticket,
    isSlaBreached: isSlaBreached(ticket),
    age_hours: ageHours,
    sla_due_label: dueDate.toISOString(),
    created_label: created.toISOString(),
    resolution_date_label: ticket.resolution_date ? new Date(ticket.resolution_date).toISOString() : null
  };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  next();
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.session.user.role)) {
      return res.status(403).json({ message: 'You do not have access to this resource.' });
    }

    next();
  };
}

async function addTicketActivity({ ticketId, user, action, details }) {
  if (!ticketId || !user) return;

  await runQuery(
    `INSERT INTO ticket_activities (ticket_id, user_id, actor_name, role, action, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [ticketId, user.id, user.name, user.role, action, details]
  );
}

async function initializeDatabase() {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'Medium',
      status TEXT NOT NULL DEFAULT 'New',
      assigned_staff_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      sla_due_at TEXT,
      resolution_date TEXT,
      resolution_notes TEXT,
      escalated INTEGER DEFAULT 0,
      last_updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(student_id) REFERENCES users(id),
      FOREIGN KEY(assigned_staff_id) REFERENCES users(id)
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS ticket_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER,
      actor_name TEXT,
      role TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id)
    )
  `);

  const userSeed = [
    ['Rahul Sharma', 'student@college.edu', 'student123', 'Student'],
    ['Ram Kumar', 'student2@college.edu', 'student123', 'Student'],
    ['Dhinesh Raj', 'staff@college.edu', 'staff123', 'Staff'],
    ['Ananya Iyer', 'admin@college.edu', 'admin123', 'Admin'],
    ['Priya Nair', 'staff2@college.edu', 'staff123', 'Staff'],
    ['Karan Verma', 'staff3@college.edu', 'staff123', 'Staff'],
    ['Meera Joshi', 'student3@college.edu', 'student123', 'Student']
  ];

  for (const [name, email, password, role] of userSeed) {
    await runQuery(
      `INSERT OR IGNORE INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
      [name, email, password, role]
    );
  }

  const sampleTicket = await getQuery(`SELECT id FROM tickets LIMIT 1`);
  if (!sampleTicket) {
    const student = await getQuery(`SELECT id FROM users WHERE email = 'student@college.edu' LIMIT 1`);
    const staff = await getQuery(`SELECT id FROM users WHERE email = 'staff@college.edu' LIMIT 1`);
    const now = new Date().toISOString();
    const due = computeSlaDate(now, 'High');

    const insertTicket = await runQuery(
      `INSERT INTO tickets (student_id, category, subject, description, priority, status, assigned_staff_id, created_at, sla_due_at, last_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [student.id, 'Fees', 'Tuition fee clarification', 'I need help understanding the recent fee statement and payment due date.', 'High', 'Assigned', staff.id, now, due, now]
    );

    await addTicketActivity({
      ticketId: insertTicket.lastID,
      user: { id: student.id, name: 'Rahul Sharma', role: 'Student' },
      action: 'Ticket created',
      details: 'Student submitted a fee clarification ticket.'
    });

    const secondTicket = await runQuery(
      `INSERT INTO tickets (student_id, category, subject, description, priority, status, assigned_staff_id, created_at, sla_due_at, last_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [student.id, 'Documents', 'ID card correction', 'My student ID card has an incorrect name spell and I need it corrected.', 'Medium', 'In Progress', staff.id, new Date(Date.now() - 86400000).toISOString(), computeSlaDate(new Date(Date.now() - 86400000).toISOString(), 'Medium'), new Date(Date.now() - 86400000).toISOString()]
    );

    await addTicketActivity({
      ticketId: secondTicket.lastID,
      user: { id: staff.id, name: 'Dhinesh Raj', role: 'Staff' },
      action: 'Status updated',
      details: 'Staff started verification for the ID card correction request.'
    });
  }
}

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.get('/api/session', (req, res) => {
  if (!req.session.user) {
    return res.json(null);
  }
  res.json(req.session.user);
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const user = await getQuery(`SELECT id, name, email, role FROM users WHERE email = ? AND password = ?`, [email.trim(), password]);

  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  req.session.user = user;
  res.json(user);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/admin/users', requireAuth, requireRole(['Admin']), async (req, res) => {
  const users = await allQuery(`SELECT id, name, email, role, created_at FROM users ORDER BY role, name ASC`);
  res.json(users);
});

app.post('/api/admin/users', requireAuth, requireRole(['Admin']), async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'User name is required.' });
  }

  if (!email || !email.trim()) {
    return res.status(400).json({ message: 'User email is required.' });
  }

  if (!password || !password.trim()) {
    return res.status(400).json({ message: 'Password is required.' });
  }

  if (!['Student', 'Staff', 'Admin'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role selected.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await getQuery(`SELECT id FROM users WHERE LOWER(email) = ?`, [normalizedEmail]);
  if (existing) {
    return res.status(409).json({ message: 'A user with this email already exists.' });
  }

  const result = await runQuery(
    `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
    [name.trim(), normalizedEmail, password, role]
  );

  const created = await getQuery(`SELECT id, name, email, role FROM users WHERE id = ?`, [result.lastID]);
  res.status(201).json({ message: 'User created successfully.', user: created });
});

app.put('/api/admin/users/:id', requireAuth, requireRole(['Admin']), async (req, res) => {
  const userId = Number(req.params.id);
  const { name, email, password, role } = req.body;

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ message: 'Invalid user id.' });
  }

  const existingUser = await getQuery(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!existingUser) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (req.session.user.id === userId && role && role !== 'Admin') {
    return res.status(400).json({ message: 'You cannot demote your own admin account.' });
  }

  const nextName = (name ?? existingUser.name).trim();
  const nextEmail = (email ?? existingUser.email).trim().toLowerCase();
  const nextRole = role ?? existingUser.role;

  if (!nextName) {
    return res.status(400).json({ message: 'User name is required.' });
  }

  if (!nextEmail) {
    return res.status(400).json({ message: 'User email is required.' });
  }

  if (!['Student', 'Staff', 'Admin'].includes(nextRole)) {
    return res.status(400).json({ message: 'Invalid role selected.' });
  }

  const duplicate = await getQuery(`SELECT id FROM users WHERE LOWER(email) = ? AND id != ?`, [nextEmail, userId]);
  if (duplicate) {
    return res.status(409).json({ message: 'Another user is already using this email.' });
  }

  const updates = ['name = ?', 'email = ?', 'role = ?'];
  const params = [nextName, nextEmail, nextRole];

  if (password && password.trim()) {
    updates.push('password = ?');
    params.push(password);
  }

  params.push(userId);

  await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  const updated = await getQuery(`SELECT id, name, email, role FROM users WHERE id = ?`, [userId]);
  res.json({ message: 'User updated successfully.', user: updated });
});

app.delete('/api/admin/users/:id', requireAuth, requireRole(['Admin']), async (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ message: 'Invalid user id.' });
  }

  if (req.session.user.id === userId) {
    return res.status(400).json({ message: 'You cannot delete your own account.' });
  }

  const target = await getQuery(`SELECT id, role FROM users WHERE id = ?`, [userId]);
  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (target.role === 'Admin') {
    const adminCount = await getQuery(`SELECT COUNT(*) as total FROM users WHERE role = 'Admin'`);
    if (Number(adminCount.total) <= 1) {
      return res.status(400).json({ message: 'At least one admin account must remain.' });
    }
  }

  await runQuery(`DELETE FROM users WHERE id = ?`, [userId]);
  res.json({ message: 'User deleted successfully.' });
});

app.get('/api/users/students', requireAuth, async (req, res) => {
  const users = await allQuery(`SELECT id, name, email FROM users WHERE role = 'Student' ORDER BY name ASC`);
  res.json(users);
});

app.get('/api/users/staff', requireAuth, async (req, res) => {
  const users = await allQuery(`SELECT id, name, email FROM users WHERE role = 'Staff' ORDER BY name ASC`);
  res.json(users);
});

app.get('/api/tickets', requireAuth, async (req, res) => {
  const user = req.session.user;
  let sql = `
    SELECT t.*, s.name as student_name, a.name as assigned_staff_name
    FROM tickets t
    LEFT JOIN users s ON s.id = t.student_id
    LEFT JOIN users a ON a.id = t.assigned_staff_id
  `;
  const params = [];

  if (user.role === 'Student') {
    sql += ' WHERE t.student_id = ?';
    params.push(user.id);
  } else if (user.role === 'Staff') {
    sql += ' WHERE t.assigned_staff_id = ? OR t.assigned_staff_id IS NULL';
    params.push(user.id);
  }

  sql += ' ORDER BY t.created_at DESC';

  const tickets = await allQuery(sql, params);
  const normalized = tickets.map(normalizeTicket);
  res.json(normalized);
});

app.get('/api/tickets/:id', requireAuth, async (req, res) => {
  const ticket = await getQuery(
    `SELECT t.*, s.name as student_name, a.name as assigned_staff_name
     FROM tickets t
     LEFT JOIN users s ON s.id = t.student_id
     LEFT JOIN users a ON a.id = t.assigned_staff_id
     WHERE t.id = ?`,
    [req.params.id]
  );

  if (!ticket) {
    return res.status(404).json({ message: 'Ticket not found.' });
  }

  const activities = await allQuery(
    `SELECT * FROM ticket_activities WHERE ticket_id = ? ORDER BY created_at DESC`,
    [req.params.id]
  );

  res.json({
    ticket: normalizeTicket(ticket),
    activities
  });
});

app.post('/api/tickets', requireAuth, async (req, res) => {
  const user = req.session.user;
  const { category, subject, description, priority, assigned_staff_id, student_id } = req.body;

  if (!category || !subject || !description) {
    return res.status(400).json({ message: 'Category, subject, and description are required.' });
  }

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'Invalid category selected.' });
  }

  if (!PRIORITIES.includes(priority || 'Medium')) {
    return res.status(400).json({ message: 'Invalid priority selected.' });
  }

  const studentUserId = user.role === 'Student' ? user.id : Number(student_id || user.id);
  const assignedStaffId = user.role === 'Admin' && assigned_staff_id ? Number(assigned_staff_id) : null;
  const createdAt = new Date().toISOString();
  const status = assignedStaffId ? 'Assigned' : 'New';
  const dueDate = computeSlaDate(createdAt, priority || 'Medium');

  const insertResult = await runQuery(
    `INSERT INTO tickets (student_id, category, subject, description, priority, status, assigned_staff_id, created_at, sla_due_at, last_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [studentUserId, category, subject, description, priority || 'Medium', status, assignedStaffId, createdAt, dueDate, createdAt]
  );

  await addTicketActivity({
    ticketId: insertResult.lastID,
    user,
    action: 'Ticket created',
    details: `New ${category} ticket created with priority ${priority || 'Medium'}.`
  });

  res.status(201).json({ message: 'Ticket created successfully.', ticketId: insertResult.lastID });
});

app.post('/api/tickets/:id/comments', requireAuth, async (req, res) => {
  const { details } = req.body;
  const user = req.session.user;

  if (!details || !details.trim()) {
    return res.status(400).json({ message: 'Comment details are required.' });
  }

  const ticket = await getQuery('SELECT id FROM tickets WHERE id = ?', [req.params.id]);
  if (!ticket) {
    return res.status(404).json({ message: 'Ticket not found.' });
  }

  await addTicketActivity({
    ticketId: ticket.id,
    user,
    action: 'Comment added',
    details
  });

  res.json({ message: 'Comment added successfully.' });
});

app.post('/api/tickets/:id/resolve', requireAuth, async (req, res) => {
  const { resolution_notes } = req.body;
  const user = req.session.user;

  const ticket = await getQuery('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!ticket) {
    return res.status(404).json({ message: 'Ticket not found.' });
  }

  if (user.role === 'Student' && ticket.student_id !== user.id) {
    return res.status(403).json({ message: 'You can only resolve your own tickets.' });
  }

  const now = new Date().toISOString();
  await runQuery(
    `UPDATE tickets SET status = 'Resolved', resolution_date = ?, resolution_notes = COALESCE(?, resolution_notes), last_updated_at = ? WHERE id = ?`,
    [now, resolution_notes || ticket.resolution_notes, now, req.params.id]
  );

  await addTicketActivity({
    ticketId: ticket.id,
    user,
    action: 'Ticket resolved',
    details: resolution_notes || 'Ticket marked as resolved.'
  });

  res.json({ message: 'Ticket marked as resolved.' });
});

app.post('/api/tickets/:id/close', requireAuth, async (req, res) => {
  const user = req.session.user;
  const ticket = await getQuery('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!ticket) {
    return res.status(404).json({ message: 'Ticket not found.' });
  }

  if (user.role === 'Student' && ticket.student_id !== user.id) {
    return res.status(403).json({ message: 'You can only close your own tickets.' });
  }

  const now = new Date().toISOString();
  await runQuery(
    `UPDATE tickets SET status = 'Closed', last_updated_at = ? WHERE id = ?`,
    [now, req.params.id]
  );

  await addTicketActivity({
    ticketId: ticket.id,
    user,
    action: 'Ticket closed',
    details: 'Student confirmed resolution and closed the ticket.'
  });

  res.json({ message: 'Ticket closed successfully.' });
});

app.post('/api/tickets/:id/escalate', requireAuth, requireRole(['Admin']), async (req, res) => {
  const ticket = await getQuery('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!ticket) {
    return res.status(404).json({ message: 'Ticket not found.' });
  }

  const user = req.session.user;
  await runQuery(
    `UPDATE tickets SET escalated = 1, status = 'In Progress', last_updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), req.params.id]
  );

  await addTicketActivity({
    ticketId: ticket.id,
    user,
    action: 'Ticket escalated',
    details: 'Admin escalated this overdue ticket for priority attention.'
  });

  res.json({ message: 'Ticket escalated successfully.' });
});

app.put('/api/tickets/:id', requireAuth, async (req, res) => {
  const user = req.session.user;
  const ticket = await getQuery('SELECT * FROM tickets WHERE id = ?', [req.params.id]);

  if (!ticket) {
    return res.status(404).json({ message: 'Ticket not found.' });
  }

  const updates = [];
  const params = [];

  if (req.body.status && STATUSES.includes(req.body.status)) {
    updates.push('status = ?');
    params.push(req.body.status);
  }

  if (req.body.priority && PRIORITIES.includes(req.body.priority)) {
    updates.push('priority = ?');
    params.push(req.body.priority);
    updates.push('sla_due_at = ?');
    params.push(computeSlaDate(ticket.created_at, req.body.priority));
  }

  if (req.body.assigned_staff_id !== undefined && user.role === 'Admin') {
    updates.push('assigned_staff_id = ?');
    params.push(req.body.assigned_staff_id || null);
  }

  if (req.body.resolution_notes !== undefined) {
    updates.push('resolution_notes = ?');
    params.push(req.body.resolution_notes || '');
  }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No valid updates provided.' });
  }

  updates.push('last_updated_at = ?');
  params.push(new Date().toISOString());
  params.push(req.params.id);

  const updateSql = `UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`;
  await runQuery(updateSql, params);

  if (req.body.status) {
    await addTicketActivity({
      ticketId: ticket.id,
      user,
      action: 'Status updated',
      details: `Status changed to ${req.body.status}.`
    });
  }

  if (req.body.assigned_staff_id !== undefined) {
    const staffName = await getQuery('SELECT name FROM users WHERE id = ?', [req.body.assigned_staff_id || null]);
    await addTicketActivity({
      ticketId: ticket.id,
      user,
      action: 'Staff assigned',
      details: staffName ? `Assigned to ${staffName.name}.` : 'Unassigned.'
    });
  }

  res.json({ message: 'Ticket updated successfully.' });
});

app.get('/api/reports', requireAuth, async (req, res) => {
  const ticketCount = await getQuery(`SELECT COUNT(*) as total FROM tickets`);
  const openCount = await getQuery(`SELECT COUNT(*) as total FROM tickets WHERE status NOT IN ('Resolved', 'Closed')`);
  const resolvedCount = await getQuery(`SELECT COUNT(*) as total FROM tickets WHERE status = 'Resolved' OR status = 'Closed'`);
  const breachCount = await allQuery(`SELECT COUNT(*) as total FROM tickets WHERE status NOT IN ('Resolved', 'Closed') AND sla_due_at < datetime('now')`);

  const statusBreakdown = await allQuery(`SELECT status, COUNT(*) as total FROM tickets GROUP BY status ORDER BY total DESC`);
  const categoryBreakdown = await allQuery(`SELECT category, COUNT(*) as total FROM tickets GROUP BY category ORDER BY total DESC`);
  const priorityBreakdown = await allQuery(`SELECT priority, COUNT(*) as total FROM tickets GROUP BY priority ORDER BY total DESC`);
  const staffBreakdown = await allQuery(`
    SELECT u.name, COUNT(t.id) as total
    FROM users u
    LEFT JOIN tickets t ON t.assigned_staff_id = u.id
    WHERE u.role = 'Staff'
    GROUP BY u.id, u.name
    ORDER BY total DESC
  `);

  const averageAging = await getQuery(`
    SELECT ROUND(AVG((strftime('%s', 'now') - strftime('%s', created_at)) / 3600), 2) as avg_hours
    FROM tickets
  `);

  res.json({
    overview: {
      total: ticketCount.total,
      open: openCount.total,
      resolved: resolvedCount.total,
      slaBreaches: breachCount[0]?.total || 0,
      averageAgeHours: averageAging.avg_hours || 0
    },
    statusBreakdown,
    categoryBreakdown,
    priorityBreakdown,
    staffBreakdown
  });
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const user = req.session.user;
  const summary = await allQuery(
    `SELECT COUNT(*) as total, SUM(CASE WHEN status NOT IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) as open,
     SUM(CASE WHEN status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) as resolved,
     SUM(CASE WHEN status NOT IN ('Resolved', 'Closed') AND sla_due_at < datetime('now') THEN 1 ELSE 0 END) as breached
     FROM tickets ${user.role === 'Student' ? 'WHERE student_id = ?' : user.role === 'Staff' ? 'WHERE assigned_staff_id = ?' : ''}`,
    user.role === 'Student' || user.role === 'Staff' ? [user.id] : []
  );

  const recent = await allQuery(
    `SELECT t.*, s.name as student_name, a.name as assigned_staff_name
     FROM tickets t
     LEFT JOIN users s ON s.id = t.student_id
     LEFT JOIN users a ON a.id = t.assigned_staff_id
     ${user.role === 'Student' ? 'WHERE t.student_id = ?' : user.role === 'Staff' ? 'WHERE t.assigned_staff_id = ?' : ''}
     ORDER BY t.created_at DESC LIMIT 5`,
    user.role === 'Student' || user.role === 'Staff' ? [user.id] : []
  );

  res.json({ summary: summary[0], recent: recent.map(normalizeTicket) });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

async function startServer() {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`College support app running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
