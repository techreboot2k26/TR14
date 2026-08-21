# QueueCraft — Deep Repository Audit & Python Backend Blueprint

## 1. EXECUTIVE SUMMARY

**QueueCraft** is currently a university smart queue and counter management prototype.
**Current Functionality:** The frontend provides a Student Dashboard, Staff Operations Dashboard, Admin Dashboard, Token Booking flow, Active Token tracking, and Service/Counter discovery.
**Frontend vs Backend:** The frontend is mostly complete using React, Vite, and React Router. A Node.js/Express backend currently exists and serves as a functional mock/prototype.
**Database:** SQLite (`queuecraft.db`).
**Frontend Expectations:** Expects REST APIs returning JSON, Firebase Authentication (or a compatible JWT mechanism) with localStorage tokens (`qc_token`), and Socket.io for real-time queue updates.
**Python Migration:** The Node.js/Express backend needs to be entirely rewritten in Python, matching the REST endpoints, Socket.io events, and SQLite schema while preserving the exact API contracts the React frontend relies upon.
**Major Architecture Risks:** Real-time Socket.io replacement in Python (requires FastAPI+python-socketio or similar), transaction atomicity during queue operations (FCFS logic, holding/skipping), and replicating the exact Firebase Auth payload parsing if the Python backend verifies Firebase tokens.
**Major Dependencies:** React, Firebase Auth (Frontend), Socket.io, SQLite.

---

## 2. COMPLETE REPOSITORY STRUCTURE

```text
e:\TechReboot\TR01/
├── src/                      # React Frontend Source
│   ├── components/           # Reusable UI components
│   │   ├── student/          # Student-facing components
│   │   ├── common/           # Shared components (Header, Notifications)
│   │   ├── AdminSidebar.tsx  # Admin navigation
│   │   ├── AnalyticsCharts.tsx
│   │   └── ...
│   ├── context/              # Global React State
│   │   ├── AuthContext.tsx   # Firebase Auth wrapper & User State
│   │   └── SocketContext.tsx # Socket.io Client wrapper
│   ├── pages/                # Route Views
│   │   ├── ActiveTokenPage.tsx
│   │   ├── AdminDashboardPage.tsx
│   │   ├── BookingPage.tsx
│   │   ├── LoginPage.tsx
│   │   ├── StaffDashboardPage.tsx
│   │   ├── StudentDashboardPage.tsx
│   │   └── TokenHistoryPage.tsx
│   ├── types/                # TypeScript Interfaces
│   ├── utils/                # Helpers
│   ├── App.tsx               # Main Router
│   └── main.tsx              # Entry Point
├── server/                   # Current Node.js Backend
│   ├── db/                   # Database logic
│   │   ├── database.ts       # SQLite connection setup
│   │   ├── schema.ts         # Table creation statements
│   │   └── seed.ts           # Mock data population
│   ├── routes/               # Express API Routes
│   │   ├── admin.ts, auth.ts, queue.ts, staffQueue.ts, student.ts, studentQueue.ts
│   ├── services/             # Backend business logic
│   ├── middleware/           # Express middlewares
│   └── index.ts              # Express Server Entry Point
├── package.json              # NPM Dependencies & Scripts
├── queuecraft.db             # SQLite Database File
├── tsconfig.json             # TypeScript Config
└── vite.config.ts            # Vite Bundler Config
```

---

## 3. ACTUAL TECHNOLOGY STACK

### Frontend
* **Framework:** React 19.0.0
* **Language:** TypeScript
* **Build system:** Vite 6.1.0
* **Router:** React Router DOM 7.2.0
* **Styling system:** Tailwind CSS (implied by typical Vite setups, index.css) / Lucide Icons
* **State management:** React Context API (`AuthContext`, `SocketContext`)
* **HTTP client:** Native `fetch` API
* **Real-time library:** Socket.io-client 4.8.1
* **Authentication:** Firebase Auth 12.17.1

### Current Backend
* **Runtime:** Node.js (v22 typings) / executed via `tsx`
* **Framework:** Express.js 4.21.2
* **Language:** TypeScript
* **Routing:** Express Router
* **Authentication:** Firebase (Client-side) + Custom JWT parsing (potentially) / standard Bearer tokens
* **Database access:** Raw SQL via `better-sqlite3` 11.8.0
* **Real-time communication:** Socket.io 4.8.1
* **Error handling:** Express generic error handlers

### Database
* **Database engine:** SQLite3
* **Schema location:** `server/db/schema.ts`
* **Connection method:** `better-sqlite3`
* **ORM/query builder:** Raw SQL
* **Migration system:** None, simple `CREATE TABLE IF NOT EXISTS` execution on startup.
* **Seed system:** `server/db/seed.ts` script executed manually or on startup.

### Infrastructure
* Docker: **CANCELLED** (No Docker files present).
* Redis: Not used.
* Cloud services: Firebase (for Auth).
* Server: Local Node.js / `tsx`.

---

## 4. FRONTEND FORENSIC ANALYSIS

**Login Page (`LoginPage.tsx`)**
* Uses Firebase `signInWithEmailAndPassword` via `AuthContext`.
* Retrieves JWT, sets `qc_token` in `localStorage`.
* Redirection based on role extracted from email/local heuristics.

**Student Dashboard (`StudentDashboardPage.tsx`)**
* Displays services.
* **API:** `GET /api/student/services`
* Expected Response: Array of Service objects.

**Booking Page (`BookingPage.tsx`)**
* Displays services and forms token.
* **API:** `GET /api/student/services`
* **API:** `POST /api/student/tokens/book`
* Expected Response: Created Token object.

**Active Token Page (`ActiveTokenPage.tsx`)**
* Displays current queue position and estimated wait.
* **API:** `GET /api/student/tokens/active`
* **API:** `POST /api/student/tokens/{id}/cancel`

**Token History Page (`TokenHistoryPage.tsx`)**
* Displays past tokens.
* **API:** `GET /api/student/tokens/history`

**Staff Dashboard (`StaffDashboardPage.tsx`)**
* Complex dashboard showing current token, waiting queue, stats.
* **API:** `GET /api/staff/dashboard`
* **API:** `POST /api/staff/counter/next`
* **API:** `POST /api/staff/tokens/{id}/complete`
* **API:** `POST /api/staff/tokens/{id}/hold`
* **API:** `POST /api/staff/tokens/{id}/resume`
* **API:** `POST /api/staff/tokens/{id}/skip`
* **API:** `PATCH /api/staff/counter/status`
* Real-time: Listens via `SocketContext` for queue updates.

**Admin Dashboard (`AdminDashboardPage.tsx`)**
* Full CRUD for system management.
* **APIs:** 
  * `GET /api/admin/dashboard`
  * `GET/POST/PUT/DELETE /api/admin/users`
  * `GET/POST/PUT/DELETE /api/admin/services`
  * `GET/POST/PUT/DELETE /api/admin/counters`
  * `GET /api/admin/live-monitor`
  * `GET /api/admin/analytics`

---

## 5. FRONTEND → BACKEND CONTRACT EXTRACTION

| Frontend Location | Method | Endpoint | Request | Response | Auth | Purpose |
| ----------------- | ------ | -------- | ------- | -------- | ---- | ------- |
| LoginPage | Firebase | `firebase/auth` | Email/Pass | Firebase Token | None | Authenticate User |
| StudentDashboard | GET | `/api/student/services` | None | `Service[]` | Bearer | Fetch available services |
| BookingPage | GET | `/api/student/services` | None | `Service[]` | Bearer | Populate booking form |
| BookingPage | POST | `/api/student/tokens/book` | `service_id`, etc. | `Token` | Bearer | Book a queue token |
| ActiveTokenPage | GET | `/api/student/tokens/active` | None | `ActiveToken` | Bearer | Track active token pos |
| ActiveTokenPage | POST | `/api/student/tokens/{id}/cancel` | None | `{message}` | Bearer | Cancel token |
| TokenHistoryPage | GET | `/api/student/tokens/history` | None | `Token[]` | Bearer | View past tokens |
| StaffDashboard | GET | `/api/staff/dashboard` | None | `DashboardData` | Bearer | Staff screen data |
| StaffDashboard | POST | `/api/staff/counter/next` | None | `{token, msg}` | Bearer | Call next token |
| StaffDashboard | POST | `/api/staff/tokens/{id}/complete`| None | `{token, msg}` | Bearer | Mark as completed |
| StaffDashboard | POST | `/api/staff/tokens/{id}/hold` | None | `{token, msg}` | Bearer | Put token on hold |
| StaffDashboard | POST | `/api/staff/tokens/{id}/resume` | None | `{token, msg}` | Bearer | Resume held token |
| StaffDashboard | POST | `/api/staff/tokens/{id}/skip` | None | `{token, msg}` | Bearer | Skip no-show token |
| StaffDashboard | PATCH | `/api/staff/counter/status` | `{status}` | `{counter}` | Bearer | Open/Close counter |
| AdminDashboard | GET | `/api/admin/dashboard` | None | `StatsData` | Bearer | Admin overview |
| AdminDashboard | GET | `/api/admin/users` | None | `User[]` | Bearer | List users |
| AdminDashboard | POST | `/api/admin/users/{id}` | User Data | `User` | Bearer | Edit user |
| AdminDashboard | DELETE | `/api/admin/users/{id}` | None | `{message}` | Bearer | Delete user |
| AdminDashboard | GET | `/api/admin/services` | None | `Service[]` | Bearer | List services |
| AdminDashboard | DELETE | `/api/admin/services/{id}` | None | `{message}` | Bearer | Delete service |
| AdminDashboard | GET | `/api/admin/counters` | None | `Counter[]` | Bearer | List counters |
| AdminDashboard | POST | `/api/admin/counters/{id}/assign`| `{staff_id}` | `Counter` | Bearer | Assign counter |
| AdminDashboard | DELETE | `/api/admin/counters/{id}` | None | `{message}` | Bearer | Delete counter |
| AdminDashboard | GET | `/api/admin/live-monitor` | None | `MonitorData` | Bearer | Live queue tracking |
| AdminDashboard | GET | `/api/admin/analytics` | None | `AnalyticsData`| Bearer | Historical charts |

---

## 6. CURRENT DATA MODELS

Extracted from `server/db/schema.ts` and `src/types`.

**User:** `id` (PK), `name`, `email`, `password_hash`, `role` (STUDENT|STAFF|ADMIN), `created_at`
**Service:** `id` (PK), `name`, `code`, `description`, `created_at`
**Counter:** `id` (PK), `service_id` (FK), `name`, `status` (OPEN|CLOSED|BUSY|MAINTENANCE), `assigned_staff_id` (FK), `created_at`
**Token:** `id` (PK), `token_number`, `student_id` (FK), `student_name`, `student_email`, `service_id` (FK), `counter_id` (FK), `priority` (NORMAL|HIGH|PRIORITY|URGENT), `status` (WAITING|SERVING|HELD|COMPLETED|SKIPPED|CANCELLED), `created_at`, `started_at`, `completed_at`, `skipped_at`, `held_at`, `notes`

**Relationships:**
`Service` 1:N `Counter`
`Service` 1:N `Token`
`Counter` 1:N `Token`
`User (Staff)` 1:1 `Counter`
`User (Student)` 1:N `Token`

---

## 7. EXISTING DATABASE FORENSIC ANALYSIS

* **Database type:** SQLite (`queuecraft.db`).
* **Schema Creation:** Explicit raw SQL string in `server/db/schema.ts`.
* **Foreign Keys:** Active (`ON DELETE CASCADE` and `ON DELETE SET NULL` used heavily).
* **Indexes:** Present on `(service_id, status)`, `(counter_id, status)`, `(priority, created_at)`, `(assigned_staff_id)`.
* **Locking/Concurrency:** Python must enforce ACID transactions during token transitions (FCFS calling) using standard SQLite connections (or WAL mode).

---

## 8. CURRENT AUTHENTICATION SYSTEM

1. Frontend calls Firebase `signInWithEmailAndPassword`.
2. Firebase returns a User object and a JWT token (`getIdToken()`).
3. Token stored in `localStorage('qc_token')`.
4. Role resolution is somewhat hardcoded in frontend (`AuthContext.tsx` uses email prefixes `admin@`, `staff.` if `localStorage` lacks an explicit role).
5. Requests to backend pass token via `Authorization: Bearer <token>`.
6. **Backend:** Express API must decode/verify the Firebase JWT (or stub it out if we replace Firebase).

---

## 9. ROLE AND PERMISSION MATRIX

| Action           | Student | Staff | Admin |
| ---------------- | ------- | ----- | ----- |
| Login            | YES     | YES   | YES   |
| View services    | YES     | YES   | YES   |
| View counters    | YES     | YES   | YES   |
| Book token       | YES     | NO    | NO    |
| Cancel own token | YES     | NO    | NO    |
| View own history | YES     | NO    | NO    |
| Operate queue    | NO      | YES   | NO    |
| Manage counter   | NO      | YES   | YES   |
| Manage service   | NO      | NO    | YES   |
| Manage staff     | NO      | NO    | YES   |
| View analytics   | NO      | NO    | YES   |

---

## 10. CURRENT QUEUE ENGINE

* **Ordering:** FCFS with Priority override (`PRIORITY/URGENT` > `NORMAL`). Ordered by `created_at ASC`.
* **Transitions:**
  * WAITING → SERVING (Counter Calls Next)
  * WAITING → CANCELLED (Student cancels)
  * SERVING → COMPLETED (Staff finishes)
  * SERVING → HELD (Staff holds)
  * SERVING → SKIPPED (No show)
  * HELD → SERVING (Staff resumes)
* **Atomicity Required:** Calling the "NEXT" token must query `WAITING` tickets and update to `SERVING` inside a transaction to prevent two staff members at different counters from calling the same token.

---

## 11. CURRENT STAFF OPERATIONS

1. Staff Login sets `role = STAFF`.
2. `AuthContext` currently *hardcodes* a mock counter assignment (`c1`, `Library Printer`) for demonstration purposes.
3. Fetch Dashboard: Retrieves current token, waiting queue array, stats.
4. **NEXT:** API finds oldest `WAITING` token for the service, updates status to `SERVING`, sets `counter_id`, emits socket event.
5. **COMPLETE/SKIP/HOLD/RESUME:** API mutates the specific token's status and timestamp.

---

## 12. CURRENT REAL-TIME SYSTEM

* **Library:** Socket.io
* **Client Setup:** `SocketContext.tsx` auto-connects to `window.location.origin`. Emits `join_counter` and `join_service` on connect.
* **Server Setup:** `server/services/socketService.ts` handles connections.
* **Required Event Inventory:**
  * `token:called` -> `counter:<id>` (Staff called a token)
  * `token:completed` -> `counter:<id>`
  * `token:held` / `resumed` / `skipped` -> `counter:<id>`
  * `queue:updated` -> `service:<id>` (Queue lengths changed, trigger student UI refetch)
  * `counter:status` -> `counter:<id>`

---

## 13. NOTIFICATION SYSTEM

* Primarily frontend Toast notifications triggered by React components (e.g., `ToastNotification.tsx`).
* Triggered heavily by HTTP response success/errors and incoming Socket.io events.

---

## 14. STUDENT EXPERIENCE — FULL BACKEND REQUIREMENTS

* **Dashboard:** Needs `/api/student/services`.
* **Booking:** Needs `/api/student/tokens/book`.
* **Active View:** Needs `/api/student/tokens/active` returning accurate `queue_position` (calculated by counting tokens ahead of it in the same service) and `estimated_wait_minutes`.
* **History:** Needs `/api/student/tokens/history` filtering by `student_id`.

---

## 15. STAFF BACKEND REQUIREMENTS

* Needs the consolidated `/api/staff/dashboard` endpoint which returns complex joined data (current token + queue list + stats).
* Needs state mutation endpoints (`/api/staff/counter/next`, `/api/staff/tokens/{id}/*`).

---

## 16. ADMIN BACKEND REQUIREMENTS

* Needs full CRUD routes across `users`, `services`, `counters`.
* Requires statistical aggregation endpoints (`/api/admin/analytics`, `/api/admin/live-monitor`) which execute GROUP BY / COUNT queries on the `tokens` table.

---

## 17. ANALYTICS REQUIREMENTS

* `AdminDashboardPage.tsx` expects:
  * Total tokens
  * Average wait time
  * Waiting vs Completed vs Cancelled breakdown
  * Daily trends
* Must calculate `estimated_wait_minutes` dynamically based on average historical completion times for that service.

---

## 18. TYPESCRIPT INTERFACE AUDIT

Frontend models are robust. The Python backend MUST return JSON with `snake_case` keys (or configure Pydantic/FastAPI to translate to `camelCase` if the frontend expects it—however, the Express backend and DB schema use `snake_case` like `service_id`, `created_at`, so Python outputting `snake_case` is expected).

---

## 19. MOCK DATA AUDIT

* **`AuthContext.tsx`:** Hardcodes counter `c1` assignment for any staff login. This **MUST** be replaced by a proper backend assignment check or API call in the Python backend.
* **`server/db/seed.ts`:** Generates dummy users and tokens. Python backend will need its own seeding mechanism for testing.

---

## 20. ENVIRONMENT CONFIGURATION

* `.env.example` exists. 
* Frontend connects to `window.location.origin` for APIs and Sockets (meaning the backend must host the static files or CORS must be configured properly in Python).
* Firebase configuration variables required.

---

## 21. ERROR HANDLING

* Express currently returns standard `{ "message": "Error description" }` payloads.
* Python backend must return standard HTTP status codes (400, 401, 403, 404, 500) with JSON body `{"detail": "..."}` or `{"message": "..."}` matching the frontend's expected format.

---

## 22. API CONTRACT INVENTORY

**See Section 5 for the full matrix.** All endpoints marked as `EXISTS` in the current Node.js backend must be ported 1:1 to Python.

---

## 23. PYTHON BACKEND MIGRATION IMPACT ANALYSIS

* **Framework Recommendation:** `FastAPI` is highly recommended. It handles async, REST APIs, JSON serialization, and has great integration with `python-socketio` for Socket.io support.
* **ORM Recommendation:** `SQLAlchemy` (sync or async) or raw `sqlite3` driver. Given the raw SQL in Node.js, `SQLAlchemy Core` or `aiosqlite` is perfect.
* **Authentication:** A Firebase Admin SDK for Python is required to verify the JWTs sent by the React frontend.

---

## 24. PYTHON BACKEND COMPATIBILITY REQUIREMENTS

**FRONTEND CONTRACTS THAT MUST NOT CHANGE:**
* All `/api/*` route paths.
* JSON Payload Keys (`service_id`, `created_at`, `status`).
* Authorization Header Format (`Bearer <token>`).
* Socket.io Event Names (`queue:updated`).
* SQLite Schema structure.

---

## 25. DATABASE MIGRATION ANALYSIS

* Database is currently SQLite `queuecraft.db`.
* The Python backend can literally mount and read the EXACT same `queuecraft.db` file.
* Schema is compatible. Python just needs to run the same `CREATE TABLE IF NOT EXISTS` commands on startup.

---

## 26. CONCURRENCY & TRANSACTION ANALYSIS

* **Atomicity Required:** The `NEXT` operation.
* Python implementation:
  ```python
  BEGIN EXCLUSIVE TRANSACTION;
  SELECT id FROM tokens WHERE status = 'WAITING' ORDER BY priority, created_at LIMIT 1;
  UPDATE tokens SET status = 'SERVING', counter_id = ? WHERE id = ?;
  COMMIT;
  ```
* SQLite locking might occur if using multithreaded workers. A single async thread or WAL mode is required.

---

## 27. QUEUE INVARIANTS

1. A token can only be `SERVING` at one counter.
2. A counter can only serve ONE token at a time.
3. Cancelled, Completed, and Skipped are terminal states.
4. Token numbers must be unique per service (e.g., `LP-001`, `LP-002`).

---

## 28. SECURITY AUDIT

* **JWT Verification:** Must ensure the Python backend actively verifies the Firebase JWT signature, not just trusting the payload.
* **Role Verification:** Must protect Staff and Admin routes securely.

---

## 29. TESTING AUDIT

* Existing backend has `vitest` configured.
* Python backend will require `pytest`, `pytest-asyncio`, and `httpx` to recreate the test suite.

---

## 30. BUILD & RUN PROCEDURE

* **Current Frontend:** `npm run dev`
* **Current Backend:** `npm run server`
* **Future Python Backend:** `uvicorn app.main:app --reload` (or similar).

---

## 31. GIT / BRANCH ANALYSIS

* **NOT DETERMINED FROM REPOSITORY** (No visible `.git` inspection performed in this summary, but Git ignores are standard).

---

## 32. BACKEND IMPLEMENTATION GAP MATRIX

| Feature | Frontend Ready | Current Backend | Python Backend Needed | Database Support | Real-Time Needed | Priority |
| ------- | -------------- | --------------- | --------------------- | ---------------- | ---------------- | -------- |
| User Auth Validation | YES | YES | **YES (Firebase)** | YES | NO | P0 |
| Student Services List| YES | YES | **YES** | YES | NO | P0 |
| Student Token Booking| YES | YES | **YES** | YES | NO | P0 |
| Staff Dashboard View | YES | YES | **YES** | YES | YES | P0 |
| Queue Transitions | YES | YES | **YES** | YES | YES | P0 |
| Admin Dashboard CRUD | YES | YES | **YES** | YES | NO | P1 |
| Admin Analytics | YES | YES | **YES** | YES | NO | P1 |

---

## 33. PYTHON BACKEND MODULE MAP

```text
app/
├── main.py             # FastAPI App, CORS, SocketIO mounting
├── config.py           # Environment variables
├── database.py         # SQLite connection & session maker
├── auth/
│   └── dependencies.py # Firebase JWT verification & RBAC
├── models/
│   └── schema.py       # SQLAlchemy Models or TypedDicts
├── routers/
│   ├── student.py
│   ├── staff.py
│   └── admin.py
├── services/
│   ├── queue_engine.py # Transactional FCFS logic
│   └── analytics.py
└── sockets/
    └── events.py       # python-socketio handlers
```

---

## 34. MIGRATION STRATEGY

**Phase 1 — Python Foundation:** Setup FastAPI, SQLite connection, and Firebase Admin verification.
**Phase 2 — Read-Only APIs:** Implement `/api/student/services`, `/api/student/counters`.
**Phase 3 — Socket.io Bridge:** Setup `python-socketio` and verify connection with React.
**Phase 4 — Queue Engine:** Implement token booking and the critical transactional `NEXT` staff operation.
**Phase 5 — Full Operations:** Implement hold/resume/skip/complete endpoints.
**Phase 6 — Admin & Analytics:** Implement complex CRUD and analytical SQL queries.

---

## 35. RISKS & DEPENDENCIES

### REAL-TIME
**Risk:** Python Socket.io server incompatibilities with Node.js client versions.
**Mitigation:** Ensure `python-socketio` version matches the JS client version (v4 protocol).

### AUTHENTICATION
**Risk:** Frontend hardcodes some roles.
**Mitigation:** Replicate the exact fallback role-resolution logic in the Python dependency injection layer.

---

## 36. WHAT MUST NOT BE CHANGED

* API paths (e.g., `/api/staff/dashboard`).
* JSON Payload Keys (`service_id`, `created_at`, `status`).
* Authorization Header Format (`Bearer <token>`).
* Socket.io Event Names (`queue:updated`).
* SQLite Schema structure.

---

## 37. FINAL PYTHON BACKEND READINESS REPORT

### CURRENT PROJECT STATE
Prototype is functionally mature on the frontend. Backend requires full 1:1 rewrite in Python.

### FRONTEND READINESS
100% Ready for Python backend integration. Expects REST + Socket.io.

### CURRENT BACKEND STATE
Node.js Express + TS prototype. Will be deprecated.

### DATABASE STATE
SQLite schema is robust and ready.

### AUTHENTICATION STATE
Firebase Client-side. Python backend needs Firebase Admin verification.

### QUEUE ENGINE STATE
Defined FCFS + Priority. Needs transactional porting to Python.

### REAL-TIME STATE
Socket.io rooms established. Python needs `python-socketio`.

### API CONTRACT STATE
Clearly defined in Express routes.

### MOCK DATA THAT MUST BE REPLACED
Hardcoded `c1` counter assignment in `AuthContext.tsx`.

### PYTHON BACKEND REQUIREMENTS
FastAPI, SQLAlchemy/sqlite3, python-socketio, firebase-admin.

### CRITICAL MIGRATION RISKS
Concurrency locks during queue transitions.

### MISSING INFORMATION
None.

### RECOMMENDED IMPLEMENTATION ORDER
Auth -> Student Read -> Socket.io -> Staff Queue Mutations -> Admin.

### RECOMMENDED PYTHON ARCHITECTURE
FastAPI modular architecture (Routers + Services + Sockets).

### FIRST BACKEND DEVELOPMENT PHASE
Setup FastAPI, CORS, SQLite DB mount, and `/api/health` + `/api/student/services`.

---

## 38. MOST IMPORTANT FINAL SECTION

# BACKEND IMPLEMENTATION BLUEPRINT

### Backend modules
* `app.main` (FastAPI + Socket.io)
* `app.routers` (student, staff, admin)
* `app.services.queue` (Transactional engine)

### Database entities
* `users`, `services`, `counters`, `tokens` (Existing SQLite, Needs SQLAlchemy/RawSQL bindings)

### API groups
* Student API (Booking, Discovery)
* Staff API (Operations, Dashboard)
* Admin API (CRUD, Analytics)

### Authentication architecture
* Firebase JWT -> `FastAPI Depends()` -> Returns parsed User object.

### Authorization architecture
* Role checks (`STUDENT`, `STAFF`, `ADMIN`) via FastAPI Dependency Injection.

### Queue architecture
* FCFS + Priority. Strict SQLite `BEGIN EXCLUSIVE` transactions for `NEXT` calls.

### Transaction boundaries
* Any status change to `tokens` table MUST be a committed transaction.

### Real-time architecture
* `python-socketio` mounted on FastAPI as ASGI app.

### Notification architecture
* Real-time events broadcasted to `counter:<id>` and `service:<id>` rooms.

### Analytics architecture
* Raw SQL aggregation queries executing against SQLite.

### Error handling architecture
* FastAPI Global Exception Handlers translating to `{"message": "..."}`.

### Validation architecture
* Pydantic Models for all incoming POST/PATCH requests.

### Testing architecture
* Pytest + httpx + pytest-asyncio.

### Configuration architecture
* `pydantic-settings` for `.env` loading.

### Migration/cutover strategy
1. Freeze React frontend.
2. Build FastAPI parallel to Node.js.
3. Switch Vite proxy to point to Python port.
4. Verify tests.
5. Deprecate Node.js server.
