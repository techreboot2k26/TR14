# Implementation Plan - Administration, Authentication & Analytics Module

Implement the complete functional Admin + Authentication + Analytics module for the QueueCraft prototype.

## Proposed Changes

### [Backend Components]




#### [NEW] [admin.ts](file:///c:/Users/USER/Desktop/gitrush/TR01/server/routes/admin.ts)
- Create `/api/admin` router.
- Protect all route handlers using `authenticateToken` and `requireRole(['ADMIN'])`.
- Implement functional endpoints:
  - `GET /dashboard`: Fetches global real-time stats count (total services, open counters, waiting tokens, served/completed today, skipped/held today, average waiting time).
  - `GET /users`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id`: User management. Enforce password hashing on creation/updates using the existing pbkdf2 helper in `seed.ts`, and omit password hashes from responses.
  - `GET /services`, `POST /services`, `PATCH /services/:id`, `DELETE /services/:id`: Service configuration CRUD.
  - `GET /counters`, `POST /counters`, `PATCH /counters/:id`, `DELETE /counters/:id`: Counter configuration CRUD.
  - `PATCH /counters/:id/assign-staff`: Explicit handler for assigning a staff user to an active counter and unassigning them (`assigned_staff_id = null`).
  - `GET /live-monitor`: Combines services and counters status, currently serving tokens, queue lengths, and assigned staff for a real-time monitor.
  - `GET /analytics`: Runs statistics queries to calculate token totals, average wait times, average service durations, service loading distributions, and completed-to-skipped/cancelled ratios.

#### [MODIFY] [index.ts](file:///c:/Users/USER/Desktop/gitrush/TR01/server/index.ts)
- Import `/api/admin` routing registry and mount under `app.use('/api/admin', adminRoutes)`.

---

### [Frontend Components]

#### [MODIFY] [App.tsx](file:///c:/Users/USER/Desktop/gitrush/TR01/src/App.tsx)
- Implement `ProtectedAdminRoute` checking for `isAuthenticated` and role `'ADMIN'`.
- Register Route `path="/admin/*"` rendering the `AdminDashboardPage` wrapped in `SocketProvider`.
- Fix the catch-all routing fallback: if the active user role is `'ADMIN'`, redirect to `/admin` instead of default `/staff`.

#### [MODIFY] [LoginPage.tsx](file:///c:/Users/USER/Desktop/gitrush/TR01/src/pages/LoginPage.tsx)
- Update login submit handler to read user role from `AuthContext` and redirect appropriately:
  - `'ADMIN'` -> nav `/admin`
  - `'STAFF'` -> nav `/staff`
- Add a quick demo button for System Admin (`admin@queuecraft.edu` / `password123`).

#### [NEW] [AdminSidebar.tsx](file:///c:/Users/USER/Desktop/gitrush/TR01/src/components/AdminSidebar.tsx)
- Build a responsive left sidebar navigation for the Admin dashboard containing tabs: Overview, Live Monitor, Services, Counters, Staff, and Analytics.
- Includes visual highlighting of active tabs and a logout trigger.

#### [NEW] [AnalyticsCharts.tsx](file:///c:/Users/USER/Desktop/gitrush/TR01/src/components/AnalyticsCharts.tsx)
- Build responsive CSS-based visual graphs and gauges displaying dashboard query metrics (service distribution percentages, completed/skipped/cancelled ratios, and timeline histograms) without introducing large chart package dependencies.

#### [NEW] [AdminDashboardPage.tsx](file:///c:/Users/USER/Desktop/gitrush/TR01/src/pages/AdminDashboardPage.tsx)
- Create container rendering the sidebar layout and the core section components:
  - **Overview**: Stats card widgets.
  - **Live Monitor**: Live grid showing status of all services and counters.
  - **Services**: CRUD management panel.
  - **Counters**: CRUD panel with staff assignment selector.
  - **Staff**: CRUD panel for operator accounts.
  - **Analytics**: Historical metrics display.

---

## Verification Plan

### Automated Tests
- Create Vitest API test suite at `server/tests/adminAPI.test.ts` to test:
  - Authentication check and RBAC blocking (non-admin returns 403).
  - Services CRUD endpoints validation.
  - Counters CRUD and Staff assignment endpoint logic.
  - Analytics aggregate calculation safety.
- Command to run tests:
  ```powershell
  npm run test
  ```

### Manual Verification
1. Register/Login as System Admin (`admin@queuecraft.edu` / `password123`) -> Verify successful redirect to `/admin`.
2. Access `/staff` folder directly as Admin -> Verify if browser redirection handles this properly or blocks.
3. Access `/admin` folder directly as Staff -> Verify blocked access and denial message/redirect.
4. Services Management: Perform Create, Edit, Delete of a test service. Verify deletion prompt validation.
5. Counter Management & Staff Assignment: Assign Staff member Rudresh to a new counter; verify change on Staff page.
6. Live Monitor and Analytics: Open a real-time staff session and call a token; verify Live Monitor updates and Analytics counters increase as tokens are processed.
