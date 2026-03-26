# Wisdomup — GPS Employee Task Tracking

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | NestJS · TypeScript · MongoDB (Mongoose) · JWT |
| Admin Panel | Next.js 16 · TypeScript · SCSS · Leaflet |
| Mobile App | Next.js (user/) |

---

## Project Structure

```
Wisdomup/
├── backend/                        # NestJS REST API
│   ├── src/
│   │   ├── config/                 # Database configuration
│   │   ├── models/                 # Mongoose schemas
│   │   │   ├── user.schema.ts
│   │   │   ├── dealer.schema.ts
│   │   │   ├── task.schema.ts
│   │   │   ├── task-assignment.schema.ts
│   │   │   ├── route.schema.ts
│   │   │   ├── route-assignment.schema.ts
│   │   │   └── activity-log.schema.ts
│   │   ├── modules/                # Feature modules
│   │   │   ├── auth/               # Login · Register · Password reset
│   │   │   ├── users/              # User CRUD
│   │   │   ├── dealers/            # Dealer CRUD + geo search
│   │   │   ├── tasks/              # Task CRUD
│   │   │   ├── task-assignments/   # Assign · Start · Complete tasks
│   │   │   ├── routes/             # Route CRUD
│   │   │   ├── route-assignments/  # Assign routes to employees
│   │   │   ├── activity-logs/      # Activity log queries
│   │   │   ├── dashboard/          # Aggregated statistics
│   │   │   └── email/              # Email service (password reset)
│   │   ├── middleware/             # JwtAuthGuard · RolesGuard
│   │   ├── decorators/             # @Roles · @CurrentUser
│   │   └── services/               # DistanceService · FileUploadService
│   ├── .env                        # Environment variables (see below)
│   └── package.json
│
├── admin/                          # Next.js Admin Panel
│   ├── pages/                      # All admin pages (routes)
│   ├── components/
│   │   ├── Layout/                 # Sidebar + header wrapper
│   │   ├── UI/                     # StatusBadge · Table · Loader · ImageModal
│   │   ├── Map/                    # Leaflet MapView component
│   │   └── Auth/                   # ProtectedRoute wrapper
│   ├── services/                   # API service layer (axios)
│   ├── contexts/                   # AuthContext
│   ├── styles/
│   └── package.json
│
└── user/                           # Mobile / Employee App (Next.js)
    ├── pages/
    ├── src/
    ├── styles/
    └── package.json
```

---

## Configuration

### Backend — `backend/.env`

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/wisdomup
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRATION=24h

# Email (password reset)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=no-reply@wisdomup.com

UPLOAD_PATH=./uploads
```

### Admin Panel — `admin/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### User / Mobile App — `user/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

---

## Setup & Running

### Backend

```bash
cd backend
npm install
npm run start:dev        # development (watch mode)
npm run build            # production build
npm run start:prod       # production
```

API runs on: `http://localhost:3000`
Swagger docs: `http://localhost:3000/api/docs`

### Admin Panel

```bash
cd admin
npm install
npm run dev              # development
npm run build            # production build
```

Admin panel runs on: `http://localhost:3001`

### Mobile / User App

```bash
cd user
npm install
npm run dev              # development
npm run build            # production build
```

User app runs on: `http://localhost:3002`

---

## Creating the First Admin Account

The public `POST /auth/register` endpoint creates **employee** accounts only.
To create the first admin, use `POST /users` with an existing admin JWT, or seed directly via the DB.

Use the Swagger UI at `http://localhost:3000/api/docs` to explore and test all API endpoints.

---

## CI/CD — Deployment

Deployments are triggered by pushing a **Git tag**. GitHub Actions SSHs into the VPS, runs `git pull origin main`, rebuilds the service, and restarts the PM2 process.

Important:
- The VPS always pulls from **`main`**.
- Pushing only a tag does **not** push your new commits to `origin/main`.
- Always push `main` first, then push the deploy tag.

### Tag Convention

| Tag pattern | Deploys |
|---|---|
| `deploy-backend-*` | Backend only (`tracking.backend`) |
| `deploy-admin-*` | Admin panel only (`tracking.admin`) |
| `deploy-user-*` | User app only (`tracking.user`) *(temporarily disabled in workflow)* |
| `deploy-all-*` | All three services |

### How to Deploy

```bash
# 1) Commit your code
git add .
git commit -m "your message"

# 2) Push commits to main (MANDATORY)
git push origin main

# 3) Create deploy tag
git tag deploy-backend-v1.1    # backend only
# OR
git tag deploy-admin-v1.1      # admin only
# OR
git tag deploy-all-v1.1        # backend + admin (+ user when re-enabled)

# 4) Push the tag
git push origin deploy-backend-v1.1
# OR matching tag name:
# git push origin deploy-admin-v1.1
# git push origin deploy-all-v1.1
```

If you skip step 2 and only run `git push origin <tag>`, GitHub Actions may run but VPS will still pull old code from `main`.

Tags must be unique — increment the suffix on each deploy (e.g. `v1.1`, `v1.2`, or use a date like `20260317`).

### Required GitHub Secrets

Go to **GitHub repo → Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|---|---|
| `VPS_HOST` | VPS IP address or domain |
| `VPS_USER` | SSH username (e.g. `ubuntu`, `root`) |
| `SSH_PRIVATE_KEY` | Contents of `~/.ssh/id_rsa` (private key) |
| `VPS_PORT` | SSH port (usually `22`) |
| `VPS_APP_PATH` | Absolute path to the repo on the VPS (e.g. `/var/www/tracking-app`) |

### PM2 Process Reference

Defined in [`pm2/ecosystem.config.js`](pm2/ecosystem.config.js). To start all processes on a fresh VPS:

```bash
pm2 start pm2/ecosystem.config.js
pm2 save
pm2 startup
```

---

## License

Private project.
